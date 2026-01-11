const api = require('./hive-engine-api.cjs');

async function test() {
  try {
    console.log('🧪 Testing HIVE-Engine API Wrapper\n');

    // Test 1: Get account balances
    console.log('1. Getting account balances...');
    const balances = await api.getAccountBalances('angelicalist');
    console.log(`✅ Found ${balances.length} tokens`);
    console.log('First 3:', balances.slice(0, 3).map(b => `${b.symbol}: ${b.balance}`).join(', '));

    // Test 2: Get VKBT order book
    console.log('\n2. Getting VKBT order book...');
    const vkbtBook = await api.getOrderBook('VKBT');
    console.log(`✅ Buy orders: ${vkbtBook.bids.length}`);
    console.log(`✅ Sell orders: ${vkbtBook.asks.length}`);

    if (vkbtBook.bids.length > 0) {
      console.log(`   Best bid: ${vkbtBook.bids[0].price} HIVE`);
    }
    if (vkbtBook.asks.length > 0) {
      console.log(`   Best ask: ${vkbtBook.asks[0].price} HIVE`);
    }

    // Test 3: Get VKBT market metrics
    console.log('\n3. Getting VKBT market metrics...');
    const vkbtMetrics = await api.getMarketMetrics('VKBT');
    if (vkbtMetrics) {
      console.log(`✅ Last price: ${vkbtMetrics.lastPrice} HIVE`);
      console.log(`   24h volume: ${vkbtMetrics.volume} HIVE`);
      console.log(`   Price change: ${vkbtMetrics.priceChangePercent}%`);
    } else {
      console.log('⚠️ No market metrics found');
    }

    // Test 4: Get CURE order book
    console.log('\n4. Getting CURE order book...');
    const cureBook = await api.getOrderBook('CURE');
    console.log(`✅ Buy orders: ${cureBook.bids.length}`);
    console.log(`✅ Sell orders: ${cureBook.asks.length}`);

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

test();
