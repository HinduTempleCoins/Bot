#!/usr/bin/env node

// ========================================
// CHECK BOT ORDERS - See if bot is placing orders
// ========================================

require('dotenv').config();
const axios = require('axios');

const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const USERNAME = process.env.HIVE_USERNAME || 'angelicalist';

async function getOpenOrders(username, symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'buyBook',
        query: { account: username, symbol: symbol },
        limit: 100
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error(`❌ Error fetching orders for ${symbol}:`, error.message);
    return [];
  }
}

async function getRecentTrades(symbol, limit = 50) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'tradesHistory',
        query: { symbol: symbol },
        limit: limit,
        indexes: [{ index: '_id', descending: true }]
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error(`❌ Error fetching trades for ${symbol}:`, error.message);
    return [];
  }
}

async function getAccountHistory(username, symbol, limit = 100) {
  // Note: This gets ALL transactions, we'll filter for buys
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'tradesHistory',
        query: {
          symbol: symbol,
          $or: [
            { buyer: username },
            { seller: username }
          ]
        },
        limit: limit,
        indexes: [{ index: '_id', descending: true }]
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error(`❌ Error fetching account history:`, error.message);
    return [];
  }
}

async function checkBotActivity() {
  console.log('🔍 Van Kush Trading Bot - Order & Activity Check');
  console.log('='.repeat(60));
  console.log(`Account: ${USERNAME}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');

  const tokens = ['VKBT', 'CURE'];

  for (const token of tokens) {
    console.log(`\n📊 ${token} Analysis`);
    console.log('-'.repeat(60));

    // Check open buy orders
    console.log(`\n🎯 OPEN BUY ORDERS:`);
    const buyOrders = await getOpenOrders(USERNAME, token);

    if (buyOrders.length === 0) {
      console.log('   ❌ No open buy orders');
    } else {
      console.log(`   ✅ ${buyOrders.length} open buy orders:`);
      buyOrders.forEach((order, i) => {
        const quantity = parseFloat(order.quantity);
        const price = parseFloat(order.price);
        const total = quantity * price;
        console.log(`   ${i+1}. Buy ${quantity.toFixed(4)} ${token} @ ${price.toFixed(8)} HIVE (Total: ${total.toFixed(4)} HIVE)`);
      });
    }

    // Check recent account trades
    console.log(`\n📈 RECENT TRADES (Last 24 hours):`);
    const accountTrades = await getAccountHistory(USERNAME, token, 100);

    if (accountTrades.length === 0) {
      console.log('   ❌ No trades found');
    } else {
      // Filter for last 24 hours
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const recentTrades = accountTrades.filter(trade => {
        // HIVE-Engine timestamps are in seconds, not ms
        const tradeTime = trade.timestamp * 1000;
        return tradeTime > oneDayAgo;
      });

      if (recentTrades.length === 0) {
        console.log('   ❌ No trades in last 24 hours');
        console.log(`   📅 Last trade was: ${accountTrades[0] ? new Date(accountTrades[0].timestamp * 1000).toISOString() : 'Never'}`);
      } else {
        console.log(`   ✅ ${recentTrades.length} trades in last 24 hours:`);

        let totalBought = 0;
        let totalSpent = 0;
        let buyCount = 0;

        recentTrades.forEach((trade, i) => {
          const isBuy = trade.buyer === USERNAME;
          const quantity = parseFloat(trade.quantity);
          const price = parseFloat(trade.price);
          const total = quantity * price;

          const tradeTime = new Date(trade.timestamp * 1000);
          const timeAgo = Math.floor((Date.now() - trade.timestamp * 1000) / (60 * 1000)); // minutes ago

          const symbol = isBuy ? '📗 BUY ' : '📕 SELL';
          console.log(`   ${symbol} ${quantity.toFixed(4)} ${token} @ ${price.toFixed(8)} HIVE`);
          console.log(`        Total: ${total.toFixed(4)} HIVE | ${timeAgo}m ago | ${tradeTime.toISOString()}`);

          if (isBuy) {
            totalBought += quantity;
            totalSpent += total;
            buyCount++;
          }
        });

        if (buyCount > 0) {
          console.log(`\n   💰 SUMMARY (Last 24h):`);
          console.log(`      Total ${token} bought: ${totalBought.toFixed(4)}`);
          console.log(`      Total HIVE spent: ${totalSpent.toFixed(4)} (~$${(totalSpent * 0.30).toFixed(2)} USD)`);
          console.log(`      Buy trades: ${buyCount}`);
          console.log(`      Average price: ${(totalSpent / totalBought).toFixed(8)} HIVE`);
        }
      }
    }

    // Check overall market activity
    console.log(`\n🌐 MARKET ACTIVITY (Last 50 trades):`);
    const marketTrades = await getRecentTrades(token, 50);

    if (marketTrades.length === 0) {
      console.log('   ⚠️  Market appears dead (no trades found)');
    } else {
      const recentMarket = marketTrades.filter(t => {
        const tradeTime = t.timestamp * 1000;
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        return tradeTime > oneDayAgo;
      });

      console.log(`   📊 ${recentMarket.length} total market trades in last 24h`);

      const ourTrades = recentMarket.filter(t => t.buyer === USERNAME || t.seller === USERNAME);
      console.log(`   🤖 Bot responsible for: ${ourTrades.length} trades (${((ourTrades.length / Math.max(recentMarket.length, 1)) * 100).toFixed(1)}% of market)`);

      if (recentMarket.length > 0) {
        const prices = recentMarket.map(t => parseFloat(t.price));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

        console.log(`   💵 Price range: ${minPrice.toFixed(8)} - ${maxPrice.toFixed(8)} HIVE`);
        console.log(`   📈 Average price: ${avgPrice.toFixed(8)} HIVE`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Analysis complete!');
  console.log('');
  console.log('💡 Tips:');
  console.log('   - Open buy orders = Bot is actively trying to buy');
  console.log('   - Recent trades = Bot has executed purchases');
  console.log('   - If no activity: Check bot is running or increase budget');
  console.log('='.repeat(60));
}

// Run the check
checkBotActivity().catch(console.error);
