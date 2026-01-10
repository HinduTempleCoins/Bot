#!/usr/bin/env node

const { execSync } = require('child_process');

const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

/**
 * CAPITAL MANAGEMENT STRATEGY
 *
 * Token Tiers:
 * 1. PREMIUM (VKBT, CURE): Scarce, strategic selling only
 * 2. FUEL (BLURT): Main capital, protected but can sell for HIVE when needed
 * 3. TRADEABLE (BBH, POB): Inflationary, sell freely for profit
 */

const CONFIG = {
  // HIVE liquidity thresholds (operational needs)
  MIN_HIVE_BALANCE: 10,           // Minimum HIVE to keep operations running
  TARGET_HIVE_BALANCE: 25,        // Target HIVE balance for operations
  CRITICAL_HIVE_BALANCE: 5,       // Critical - sell immediately

  // HIVE reserve building (long-term wealth)
  RESERVE_TIER_1: 50,             // First reserve milestone → consider power up
  RESERVE_TIER_2: 100,            // Second milestone → power up more
  RESERVE_TIER_3: 200,            // Third milestone → aggressive power up
  POWER_UP_PERCENT: 0.5,          // Power up 50% of excess reserves

  // BLURT selling strategy (gradual, don't break market)
  BLURT_SELL_MODE: 'TOP_ORDER_ONLY', // Only sell to top buy order
  BLURT_SELL_COOLDOWN_HOURS: 1,   // Wait 1h between BLURT sells
  MIN_BLURT_RESERVE: 50,           // Always keep at least 50 BLURT
  MIN_BLURT_BUY_PRICE: 0.0,        // Accept market price (BLURT needs our intervention to rise)

  // Token classifications
  PREMIUM_TOKENS: ['VKBT', 'CURE'], // Strategic selling only
  FUEL_TOKEN: 'SWAP.BLURT',         // Protected fuel
  TRADEABLE_TOKENS: ['BBH', 'POB'], // Sell freely

  // Spending tracking
  SPENDING_WINDOW_HOURS: 24,       // Track spending over 24h
  HIGH_BURN_RATE_THRESHOLD: 20     // Alert if spending >20 HIVE/day
};

/**
 * Make API call using curl
 */
function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");

  const cmd = `curl -s -X POST ${HIVE_ENGINE_RPC} \
    -H "Content-Type: application/json" \
    -d '${escaped}'`;

  const output = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(output);
}

/**
 * Get token balance for account
 */
function getBalance(account, symbol) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account, symbol },
      limit: 1,
      offset: 0,
      indexes: []
    }
  };

  const result = apiCall(payload);
  return result.result && result.result.length > 0
    ? parseFloat(result.result[0].balance)
    : 0;
}

/**
 * Get current market price for a token
 */
function getMarketPrice(symbol) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'metrics',
      query: { symbol },
      limit: 1,
      offset: 0,
      indexes: []
    }
  };

  const result = apiCall(payload);
  if (!result.result || result.result.length === 0) return null;

  return {
    lastPrice: parseFloat(result.result[0].lastPrice),
    lowestAsk: parseFloat(result.result[0].lowestAsk),
    highestBid: parseFloat(result.result[0].highestBid),
    volume: parseFloat(result.result[0].volume)
  };
}

/**
 * Analyze buy wall depth for selling token
 */
function analyzeBuyWall(symbol, quantity) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit: 100,
      offset: 0,
      indexes: [{ index: 'price', descending: true }]
    }
  };

  const result = apiCall(payload);
  if (!result.result || result.result.length === 0) {
    return { canSell: false, totalRevenue: 0, averagePrice: 0, topOrder: null };
  }

  const buyOrders = result.result;
  let remaining = quantity;
  let totalRevenue = 0;
  let ordersFilled = 0;

  for (const order of buyOrders) {
    if (remaining <= 0) break;

    const orderQuantity = parseFloat(order.quantity);
    const price = parseFloat(order.price);
    const fillAmount = Math.min(remaining, orderQuantity);

    totalRevenue += fillAmount * price;
    remaining -= fillAmount;
    ordersFilled++;
  }

  // Get top order details
  const topOrder = buyOrders[0] ? {
    price: parseFloat(buyOrders[0].price),
    quantity: parseFloat(buyOrders[0].quantity),
    account: buyOrders[0].account
  } : null;

  return {
    canSell: remaining === 0,
    totalRevenue,
    averagePrice: totalRevenue / quantity,
    percentFilled: ((quantity - remaining) / quantity) * 100,
    ordersFilled,
    buyWallTop: topOrder ? topOrder.price : 0,
    buyWallDepth: buyOrders.length,
    topOrder
  };
}

/**
 * Get top buy order only (for gradual BLURT selling)
 */
function getTopBuyOrder(symbol) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit: 1,
      offset: 0,
      indexes: [{ index: 'price', descending: true }]
    }
  };

  const result = apiCall(payload);
  if (!result.result || result.result.length === 0) return null;

  const order = result.result[0];
  return {
    price: parseFloat(order.price),
    quantity: parseFloat(order.quantity),
    account: order.account
  };
}

/**
 * Check if HIVE reserves warrant power-up
 */
function checkPowerUpOpportunity(hiveBalance) {
  console.log('\n\n⚡ POWER-UP OPPORTUNITY CHECK');
  console.log('='.repeat(60));

  // Only consider power-up if operations are fully funded
  if (hiveBalance < CONFIG.TARGET_HIVE_BALANCE) {
    console.log(`HIVE balance (${hiveBalance.toFixed(2)}) below operational target (${CONFIG.TARGET_HIVE_BALANCE})`);
    console.log('Focus on operations first - no power-up yet');
    return {
      shouldPowerUp: false,
      amount: 0,
      reason: 'Operations need funding first'
    };
  }

  const excess = hiveBalance - CONFIG.TARGET_HIVE_BALANCE;
  console.log(`\nOperational HIVE: ${CONFIG.TARGET_HIVE_BALANCE}`);
  console.log(`Current HIVE: ${hiveBalance.toFixed(2)}`);
  console.log(`Excess reserves: ${excess.toFixed(2)}`);

  // Check which tier we're at
  if (excess >= CONFIG.RESERVE_TIER_3) {
    const powerUpAmount = excess * CONFIG.POWER_UP_PERCENT;
    console.log(`\n🚀 TIER 3 REACHED (${CONFIG.RESERVE_TIER_3}+ excess)`);
    console.log(`   Recommendation: AGGRESSIVE POWER-UP`);
    console.log(`   Amount: ${powerUpAmount.toFixed(2)} HIVE (${(CONFIG.POWER_UP_PERCENT * 100)}% of excess)`);
    console.log(`   Remaining: ${(excess - powerUpAmount).toFixed(2)} HIVE reserves`);
    return {
      shouldPowerUp: true,
      amount: powerUpAmount,
      tier: 3,
      reason: 'Tier 3 reserves - aggressive growth'
    };
  } else if (excess >= CONFIG.RESERVE_TIER_2) {
    const powerUpAmount = excess * CONFIG.POWER_UP_PERCENT;
    console.log(`\n📈 TIER 2 REACHED (${CONFIG.RESERVE_TIER_2}+ excess)`);
    console.log(`   Recommendation: MODERATE POWER-UP`);
    console.log(`   Amount: ${powerUpAmount.toFixed(2)} HIVE (${(CONFIG.POWER_UP_PERCENT * 100)}% of excess)`);
    return {
      shouldPowerUp: true,
      amount: powerUpAmount,
      tier: 2,
      reason: 'Tier 2 reserves - moderate growth'
    };
  } else if (excess >= CONFIG.RESERVE_TIER_1) {
    const powerUpAmount = excess * CONFIG.POWER_UP_PERCENT;
    console.log(`\n💰 TIER 1 REACHED (${CONFIG.RESERVE_TIER_1}+ excess)`);
    console.log(`   Recommendation: CONSIDER POWER-UP`);
    console.log(`   Amount: ${powerUpAmount.toFixed(2)} HIVE (${(CONFIG.POWER_UP_PERCENT * 100)}% of excess)`);
    return {
      shouldPowerUp: true,
      amount: powerUpAmount,
      tier: 1,
      reason: 'Tier 1 reserves - start building HP'
    };
  } else {
    console.log(`\nNot yet at Tier 1 (need ${CONFIG.RESERVE_TIER_1} excess, have ${excess.toFixed(2)})`);
    console.log('Keep accumulating reserves');
    return {
      shouldPowerUp: false,
      amount: 0,
      reason: `Need ${(CONFIG.RESERVE_TIER_1 - excess).toFixed(2)} more HIVE to reach Tier 1`
    };
  }
}

/**
 * Check if we need to sell BLURT for HIVE
 */
async function checkCapitalNeeds(account) {
  console.log('\n💰 CAPITAL MANAGER - Liquidity Check');
  console.log('='.repeat(60));

  // Get current balances
  const hiveBalance = getBalance(account, 'SWAP.HIVE');
  const blurtBalance = getBalance(account, CONFIG.FUEL_TOKEN);

  console.log(`\n📊 Current Balances:`);
  console.log(`   SWAP.HIVE: ${hiveBalance.toFixed(2)}`);
  console.log(`   SWAP.BLURT: ${blurtBalance.toFixed(2)}`);

  // Check HIVE balance status
  let status = 'HEALTHY';
  let recommendation = 'HOLD';
  let urgency = 0;

  if (hiveBalance < CONFIG.CRITICAL_HIVE_BALANCE) {
    status = 'CRITICAL';
    recommendation = 'SELL_BLURT_NOW';
    urgency = 100;
  } else if (hiveBalance < CONFIG.MIN_HIVE_BALANCE) {
    status = 'LOW';
    recommendation = 'SELL_BLURT_SOON';
    urgency = 75;
  } else if (hiveBalance < CONFIG.TARGET_HIVE_BALANCE) {
    status = 'MODERATE';
    recommendation = 'MONITOR';
    urgency = 30;
  }

  console.log(`\n🎯 HIVE Status: ${status} (${urgency}% urgency)`);
  console.log(`   Recommendation: ${recommendation}`);

  // Calculate how much BLURT to sell
  if (recommendation.includes('SELL_BLURT')) {
    const hiveNeeded = CONFIG.TARGET_HIVE_BALANCE - hiveBalance;
    const blurtPrice = getMarketPrice(CONFIG.FUEL_TOKEN);

    if (!blurtPrice || !blurtPrice.highestBid) {
      console.log('\n⚠️  Cannot get BLURT market price - WAIT');
      return { recommendation: 'WAIT', reason: 'No market data' };
    }

    // Calculate BLURT needed (with 10% buffer for slippage)
    const blurtNeeded = (hiveNeeded / blurtPrice.highestBid) * 1.1;
    const blurtAvailable = blurtBalance - CONFIG.MIN_BLURT_RESERVE;

    console.log(`\n💱 Conversion Analysis:`);
    console.log(`   HIVE needed: ${hiveNeeded.toFixed(2)}`);
    console.log(`   BLURT price: ${blurtPrice.highestBid.toFixed(8)} HIVE`);
    console.log(`   BLURT needed: ${blurtNeeded.toFixed(2)}`);
    console.log(`   BLURT available: ${blurtAvailable.toFixed(2)} (keeping ${CONFIG.MIN_BLURT_RESERVE} reserve)`);

    if (blurtAvailable < blurtNeeded) {
      console.log('\n⚠️  Not enough BLURT to cover full HIVE needs!');
      console.log(`   HIVE needed: ${hiveNeeded.toFixed(2)}`);
      console.log(`   BLURT available: ${blurtAvailable.toFixed(2)}`);
      console.log(`   Will need to sell gradually as orders appear`);
    }

    // STRATEGY: Only sell to TOP order (don't break down the wall)
    console.log(`\n📊 Gradual BLURT Selling Strategy (TOP ORDER ONLY)`);

    const topOrder = getTopBuyOrder(CONFIG.FUEL_TOKEN);

    if (!topOrder) {
      console.log(`   ⚠️  No buy orders available`);
      return {
        recommendation: 'WAIT_BUY_ORDERS',
        urgency,
        status,
        reason: 'No BLURT buy orders - wait for market'
      };
    }

    console.log(`   Top order: ${topOrder.quantity.toFixed(2)} BLURT @ ${topOrder.price.toFixed(8)} HIVE`);
    console.log(`   Buyer: @${topOrder.account}`);

    // Check if top order price is acceptable
    if (topOrder.price < CONFIG.MIN_BLURT_BUY_PRICE) {
      console.log(`   ⚠️  Price too low (${topOrder.price.toFixed(8)} < ${CONFIG.MIN_BLURT_BUY_PRICE})`);

      if (status === 'CRITICAL') {
        console.log(`   BUT status is CRITICAL - sell anyway!`);
        const sellAmount = Math.min(topOrder.quantity, blurtAvailable);
        const expectedHIVE = sellAmount * topOrder.price;

        return {
          recommendation: 'SELL_TO_TOP_ORDER_CRITICAL',
          amount: sellAmount,
          expectedHIVE,
          urgency,
          status,
          price: topOrder.price,
          reason: 'Critical HIVE shortage - accepting low price'
        };
      } else {
        return {
          recommendation: 'WAIT_BETTER_PRICE',
          urgency,
          status,
          currentPrice: topOrder.price,
          reason: `Price too low - waiting for >= ${CONFIG.MIN_BLURT_BUY_PRICE} HIVE`
        };
      }
    }

    // Sell to top order only
    const sellAmount = Math.min(topOrder.quantity, blurtAvailable);
    const expectedHIVE = sellAmount * topOrder.price;

    console.log(`\n   ✅ SELL TO TOP ORDER`);
    console.log(`   Amount: ${sellAmount.toFixed(2)} BLURT`);
    console.log(`   Expected: ${expectedHIVE.toFixed(4)} HIVE`);
    console.log(`   Strategy: Fill top order, wait for next, repeat`);

    if (sellAmount < blurtNeeded) {
      console.log(`\n   ⚠️  Top order only covers ${(sellAmount / blurtNeeded * 100).toFixed(1)}% of need`);
      console.log(`   Will need multiple gradual sells (1h cooldown between)`);
    }

    return {
      recommendation: 'SELL_TO_TOP_ORDER',
      amount: sellAmount,
      expectedHIVE,
      urgency,
      status,
      price: topOrder.price,
      reason: `Sell ${sellAmount.toFixed(2)} BLURT to top order, preserve market`
    };
  }

  return {
    recommendation: 'HOLD',
    urgency: 0,
    status: 'HEALTHY',
    reason: `HIVE balance sufficient: ${hiveBalance.toFixed(2)}`
  };
}

/**
 * Check tradeable tokens (BBH, POB) for profit opportunities
 */
async function checkTradeableTokens(account) {
  console.log('\n\n🔄 CHECKING TRADEABLE TOKENS (BBH, POB)');
  console.log('='.repeat(60));

  const opportunities = [];

  for (const symbol of CONFIG.TRADEABLE_TOKENS) {
    const balance = getBalance(account, symbol);

    if (balance < 0.01) {
      console.log(`\n${symbol}: ${balance.toFixed(2)} - TOO LOW`);
      continue;
    }

    console.log(`\n${symbol}: ${balance.toFixed(2)}`);

    const price = getMarketPrice(symbol);
    if (!price || !price.highestBid) {
      console.log(`   ⚠️  No market data`);
      continue;
    }

    console.log(`   Price: ${price.highestBid.toFixed(8)} HIVE`);
    console.log(`   Value: ${(balance * price.highestBid).toFixed(4)} HIVE`);

    // Analyze if we can sell 50% of holdings
    const sellAmount = balance * 0.5;
    const buyWall = analyzeBuyWall(symbol, sellAmount);

    console.log(`   Buy wall for ${sellAmount.toFixed(2)} ${symbol}:`);
    console.log(`      Can fill: ${buyWall.percentFilled.toFixed(1)}%`);
    console.log(`      Revenue: ${buyWall.totalRevenue.toFixed(4)} HIVE`);

    if (buyWall.percentFilled >= 90 && buyWall.totalRevenue >= 0.1) {
      opportunities.push({
        symbol,
        balance,
        sellAmount,
        expectedHIVE: buyWall.totalRevenue,
        recommendation: 'CAN_SELL'
      });
      console.log(`   ✅ SELLABLE - Can convert to HIVE if needed`);
    } else {
      console.log(`   ⚠️  Low liquidity - hold for now`);
    }
  }

  return opportunities;
}

/**
 * Main capital management check
 */
async function main() {
  const account = process.argv[2] || 'angelicalist';

  console.log(`\n💼 CAPITAL MANAGER FOR @${account}`);
  console.log('='.repeat(60));
  console.log(`\nStrategy:`);
  console.log(`  • Premium (VKBT, CURE): Strategic selling only`);
  console.log(`  • Fuel (BLURT): Sell for HIVE when needed`);
  console.log(`  • Tradeable (BBH, POB): Sell freely for profit\n`);

  // Check if we need to sell BLURT for HIVE
  const capitalNeeds = await checkCapitalNeeds(account);

  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📋 CAPITAL MANAGER RECOMMENDATION`);
  console.log('='.repeat(60));
  console.log(`Action: ${capitalNeeds.recommendation}`);
  console.log(`Urgency: ${capitalNeeds.urgency}%`);
  console.log(`Status: ${capitalNeeds.status}`);
  console.log(`Reason: ${capitalNeeds.reason}`);

  if (capitalNeeds.amount) {
    console.log(`\n💱 Conversion:`);
    console.log(`   Sell: ${capitalNeeds.amount.toFixed(2)} BLURT`);
    console.log(`   Get: ~${capitalNeeds.expectedHIVE.toFixed(2)} HIVE`);
    if (capitalNeeds.price) {
      console.log(`   Price: ${capitalNeeds.price.toFixed(8)} HIVE per BLURT`);
    }
  }

  // Check for power-up opportunities
  const hiveBalance = getBalance(account, 'SWAP.HIVE');
  const powerUpCheck = checkPowerUpOpportunity(hiveBalance);

  if (powerUpCheck.shouldPowerUp) {
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`⚡ POWER-UP RECOMMENDATION`);
    console.log('='.repeat(60));
    console.log(`Tier: ${powerUpCheck.tier} (Reserve building)`);
    console.log(`Amount: ${powerUpCheck.amount.toFixed(2)} HIVE`);
    console.log(`Reason: ${powerUpCheck.reason}`);
    console.log(`\nLong-term: Build HIVE POWER → Earn curation rewards`);
  }

  // Check tradeable tokens
  const tradeableOps = await checkTradeableTokens(account);

  if (tradeableOps.length > 0) {
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`📊 TRADEABLE TOKEN OPPORTUNITIES`);
    console.log('='.repeat(60));

    tradeableOps.forEach(op => {
      console.log(`\n${op.symbol}:`);
      console.log(`   Sell: ${op.sellAmount.toFixed(2)} ${op.symbol}`);
      console.log(`   Get: ${op.expectedHIVE.toFixed(4)} HIVE`);
    });
  }

  console.log('\n');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  checkCapitalNeeds,
  checkTradeableTokens,
  checkPowerUpOpportunity,
  getTopBuyOrder
};
