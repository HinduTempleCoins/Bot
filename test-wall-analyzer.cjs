#!/usr/bin/env node

// ========================================
// WALL ANALYZER TEST SCRIPT
// ========================================
// Purpose: Test buy/sell wall analysis for VKBT and CURE
// Usage: node test-wall-analyzer.cjs
// Author: Claude Code
// Date: 2026-01-10

const {
  analyzeSellWall,
  analyzeBuyWall,
  checkMarketHealth,
  findBestPushOpportunity
} = require('./wall-analyzer.cjs');

async function runTests() {
  console.log('🧪 WALL ANALYZER TEST SUITE\n');
  console.log('=' .repeat(60));

  try {
    // Test 1: Analyze VKBT sell wall
    console.log('\n📝 TEST 1: VKBT Sell Wall Analysis');
    console.log('=' .repeat(60));
    const vkbtWall = await analyzeSellWall('VKBT');
    console.log('\nResult:', JSON.stringify(vkbtWall, null, 2));

    // Test 2: Analyze CURE sell wall
    console.log('\n\n📝 TEST 2: CURE Sell Wall Analysis');
    console.log('=' .repeat(60));
    const cureWall = await analyzeSellWall('CURE');
    console.log('\nResult:', JSON.stringify(cureWall, null, 2));

    // Test 3: Check VKBT market health
    console.log('\n\n📝 TEST 3: VKBT Market Health');
    console.log('=' .repeat(60));
    const vkbtHealth = await checkMarketHealth('VKBT');
    console.log('\nResult:', JSON.stringify(vkbtHealth, null, 2));

    // Test 4: Check CURE market health
    console.log('\n\n📝 TEST 4: CURE Market Health');
    console.log('=' .repeat(60));
    const cureHealth = await checkMarketHealth('CURE');
    console.log('\nResult:', JSON.stringify(cureHealth, null, 2));

    // Test 5: Analyze buy wall (simulate selling 100 VKBT)
    console.log('\n\n📝 TEST 5: VKBT Buy Wall (Selling 100 VKBT)');
    console.log('=' .repeat(60));
    const vkbtBuyWall = await analyzeBuyWall('VKBT', 100);
    console.log('\nResult:', JSON.stringify(vkbtBuyWall, null, 2));

    // Test 6: Find best opportunity
    console.log('\n\n📝 TEST 6: Find Best Push Opportunity');
    console.log('=' .repeat(60));
    const bestOpp = await findBestPushOpportunity();
    if (bestOpp) {
      console.log('\nResult:', JSON.stringify(bestOpp, null, 2));
    }

    // Summary
    console.log('\n\n📊 SUMMARY');
    console.log('=' .repeat(60));

    if (vkbtWall.isAffordable) {
      console.log(`✅ VKBT: Affordable to push ($${vkbtWall.costUSD.toFixed(2)}) - ${vkbtWall.recommendation}`);
    } else {
      console.log(`❌ VKBT: Too expensive ($${vkbtWall.costUSD.toFixed(2)}) - ${vkbtWall.recommendation}`);
    }

    if (cureWall.isAffordable) {
      console.log(`✅ CURE: Affordable to push ($${cureWall.costUSD.toFixed(2)}) - ${cureWall.recommendation}`);
    } else {
      console.log(`❌ CURE: Too expensive ($${cureWall.costUSD.toFixed(2)}) - ${cureWall.recommendation}`);
    }

    console.log(`\nVKBT Market: ${vkbtHealth.isAlive ? '✅ ALIVE' : '❌ DEAD'} (${vkbtHealth.reason})`);
    console.log(`CURE Market: ${cureHealth.isAlive ? '✅ ALIVE' : '❌ DEAD'} (${cureHealth.reason})`);

    if (bestOpp) {
      console.log(`\n🎯 RECOMMENDED ACTION: ${bestOpp.recommendation} on ${bestOpp.token}`);
      console.log(`   Cost: $${bestOpp.costUSD.toFixed(2)} USD`);
      console.log(`   Score: ${bestOpp.score.toFixed(2)}/100`);
    } else {
      console.log('\n⚠️ No recommended actions at this time');
    }

    console.log('\n✅ All tests completed!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();
