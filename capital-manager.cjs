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
  // HIVE liquidity thresholds
  MIN_HIVE_BALANCE: 10,           // Minimum HIVE to keep operations running
  TARGET_HIVE_BALANCE: 25,        // Target HIVE balance after BLURT sale
  CRITICAL_HIVE_BALANCE: 5,       // Critical - sell BLURT immediately

  // BLURT → HIVE conversion settings
  BLURT_TO_HIVE_RATIO: 0.3,       // Approx BLURT:HIVE price ratio
  MIN_BLURT_RESERVE: 50,          // Always keep at least 50 BLURT

  // Token classifications
  PREMIUM_TOKENS: ['VKBT', 'CURE'],
  FUEL_TOKEN: 'SWAP.BLURT',
  TRADEABLE_TOKENS: ['BBH', 'POB'],

  // Spending tracking
  SPENDING_WINDOW_HOURS: 24,      // Track spending over 24h
  HIGH_BURN_RATE_THRESHOLD: 20    // Alert if spending >20 HIVE/day
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
    return { canSell: false, totalRevenue: 0, averagePrice: 0 };
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

  return {
    canSell: remaining === 0,
    totalRevenue,
    averagePrice: totalRevenue / quantity,
    percentFilled: ((quantity - remaining) / quantity) * 100,
    ordersFilled,
    buyWallTop: buyOrders[0] ? parseFloat(buyOrders[0].price) : 0,
    buyWallDepth: buyOrders.length
  };
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
      console.log('\n⚠️  Not enough BLURT to cover HIVE needs!');
      console.log(`   Can only sell: ${blurtAvailable.toFixed(2)} BLURT`);

      // Sell what we can
      if (blurtAvailable > 0) {
        const buyWall = analyzeBuyWall(CONFIG.FUEL_TOKEN, blurtAvailable);
        console.log(`\n📊 Buy Wall Analysis:`);
        console.log(`   Can sell all: ${buyWall.canSell ? 'YES' : 'NO'}`);
        console.log(`   Expected HIVE: ${buyWall.totalRevenue.toFixed(2)}`);
        console.log(`   Average price: ${buyWall.averagePrice.toFixed(8)}`);

        return {
          recommendation: 'SELL_PARTIAL_BLURT',
          amount: blurtAvailable,
          expectedHIVE: buyWall.totalRevenue,
          urgency,
          status,
          reason: 'Insufficient BLURT - selling all available'
        };
      } else {
        return {
          recommendation: 'CRITICAL_NO_BLURT',
          urgency: 100,
          status: 'CRITICAL',
          reason: 'No BLURT available to sell, operations may halt'
        };
      }
    }

    // Check if buy wall can absorb this sale
    const buyWall = analyzeBuyWall(CONFIG.FUEL_TOKEN, blurtNeeded);

    console.log(`\n📊 Buy Wall Analysis:`);
    console.log(`   Can sell ${blurtNeeded.toFixed(2)} BLURT: ${buyWall.canSell ? 'YES' : 'NO'}`);
    console.log(`   Percent fillable: ${buyWall.percentFilled.toFixed(1)}%`);
    console.log(`   Expected HIVE: ${buyWall.totalRevenue.toFixed(2)}`);
    console.log(`   Average price: ${buyWall.averagePrice.toFixed(8)}`);
    console.log(`   Buy orders: ${buyWall.ordersFilled}/${buyWall.buyWallDepth}`);

    if (buyWall.percentFilled < 90) {
      console.log(`\n⚠️  Buy wall too shallow - would get poor price`);

      if (status === 'CRITICAL') {
        console.log(`   BUT status is CRITICAL - sell anyway!`);
        return {
          recommendation: 'SELL_BLURT_CRITICAL',
          amount: blurtNeeded,
          expectedHIVE: buyWall.totalRevenue,
          urgency,
          status,
          reason: 'Critical HIVE shortage - accepting poor price'
        };
      } else {
        return {
          recommendation: 'WAIT_BETTER_WALL',
          urgency,
          status,
          reason: 'Buy wall too shallow - wait for better depth'
        };
      }
    }

    return {
      recommendation: 'SELL_BLURT',
      amount: blurtNeeded,
      expectedHIVE: buyWall.totalRevenue,
      urgency,
      status,
      reason: `Replenish HIVE from ${hiveBalance.toFixed(2)} to ${CONFIG.TARGET_HIVE_BALANCE}`
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

module.exports = { checkCapitalNeeds, checkTradeableTokens };
