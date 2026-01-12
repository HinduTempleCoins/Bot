#!/usr/bin/env node

const { execSync } = require('child_process');

const ACCOUNT = 'angelicalist';
const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const DAYS_BACK = 3;

/**
 * Make API call using curl
 */
function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");

  const cmd = `curl -s -X POST ${HIVE_ENGINE_RPC} \
    -H "Content-Type: application/json" \
    -d '${escaped}'`;

  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(output);
}

/**
 * Get open buy orders
 */
async function getOpenBuyOrders(account) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { account },
      limit: 1000
    }
  });

  return result.result || [];
}

/**
 * Get open sell orders
 */
async function getOpenSellOrders(account) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'sellBook',
      query: { account },
      limit: 1000
    }
  });

  return result.result || [];
}

/**
 * Get trade history (filled orders)
 */
async function getTradeHistory(account, limit = 1000) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'tradesHistory',
      query: {
        $or: [
          { buyer: account },
          { seller: account }
        ]
      },
      limit: limit,
      indexes: []
    }
  });

  return result.result || [];
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 TRADING ACTIVITY REPORT FOR @${ACCOUNT}`);
  console.log('='.repeat(80));

  const cutoffTime = Date.now() / 1000 - (DAYS_BACK * 24 * 60 * 60);

  // Get open orders
  console.log('\n📋 Fetching open orders...');
  const openBuys = await getOpenBuyOrders(ACCOUNT);
  const openSells = await getOpenSellOrders(ACCOUNT);

  // Get trade history
  console.log('📋 Fetching trade history...');
  const allTrades = await getTradeHistory(ACCOUNT);

  // Filter to last 3 days
  const recentTrades = allTrades.filter(trade => trade.timestamp > cutoffTime);

  console.log('\n' + '='.repeat(80));
  console.log('🔓 OPEN ORDERS (Current)');
  console.log('='.repeat(80));

  if (openBuys.length === 0 && openSells.length === 0) {
    console.log('\n⚠️  No open orders');
  } else {
    if (openBuys.length > 0) {
      console.log(`\n💰 OPEN BUY ORDERS (${openBuys.length}):\n`);
      openBuys
        .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
        .forEach((order, i) => {
          console.log(`${i + 1}. ${order.symbol}`);
          console.log(`   Price: ${parseFloat(order.price).toFixed(8)} HIVE`);
          console.log(`   Quantity: ${parseFloat(order.quantity).toFixed(8)} ${order.symbol}`);
          console.log(`   Total: ${(parseFloat(order.price) * parseFloat(order.quantity)).toFixed(8)} HIVE`);
          console.log(`   TX: ${order.txId}`);
          console.log('');
        });
    }

    if (openSells.length > 0) {
      console.log(`\n📤 OPEN SELL ORDERS (${openSells.length}):\n`);
      openSells
        .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
        .forEach((order, i) => {
          console.log(`${i + 1}. ${order.symbol}`);
          console.log(`   Price: ${parseFloat(order.price).toFixed(8)} HIVE`);
          console.log(`   Quantity: ${parseFloat(order.quantity).toFixed(8)} ${order.symbol}`);
          console.log(`   Total: ${(parseFloat(order.price) * parseFloat(order.quantity)).toFixed(8)} HIVE`);
          console.log(`   TX: ${order.txId}`);
          console.log('');
        });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`✅ FILLED TRADES (Past ${DAYS_BACK} Days)`);
  console.log('='.repeat(80));

  if (recentTrades.length === 0) {
    console.log('\n⚠️  No trades in the past 3 days');
  } else {
    console.log(`\n📈 Found ${recentTrades.length} trades:\n`);

    recentTrades
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach((trade, i) => {
        const isBuyer = trade.buyer.toLowerCase() === ACCOUNT.toLowerCase();
        const side = isBuyer ? '💰 BUY' : '📤 SELL';
        const counterparty = isBuyer ? trade.seller : trade.buyer;

        console.log(`${i + 1}. ${side} ${trade.symbol}`);
        console.log(`   Price: ${parseFloat(trade.price).toFixed(8)} HIVE`);
        console.log(`   Quantity: ${parseFloat(trade.quantity).toFixed(8)} ${trade.symbol}`);
        console.log(`   Total: ${(parseFloat(trade.price) * parseFloat(trade.quantity)).toFixed(8)} HIVE`);
        console.log(`   Counterparty: @${counterparty}`);

        const date = new Date(trade.timestamp * 1000).toISOString();
        console.log(`   Time: ${date}`);
        console.log(`   TX: ${trade.txId}`);
        console.log('');
      });

    // Summary statistics
    console.log('='.repeat(80));
    console.log('📊 SUMMARY STATISTICS');
    console.log('='.repeat(80));

    const buys = recentTrades.filter(t => t.buyer.toLowerCase() === ACCOUNT.toLowerCase());
    const sells = recentTrades.filter(t => t.seller.toLowerCase() === ACCOUNT.toLowerCase());

    console.log(`\nTotal trades: ${recentTrades.length}`);
    console.log(`Buys: ${buys.length}`);
    console.log(`Sells: ${sells.length}`);

    // By token
    const tokenStats = {};
    recentTrades.forEach(trade => {
      const isBuyer = trade.buyer.toLowerCase() === ACCOUNT.toLowerCase();
      const symbol = trade.symbol;

      if (!tokenStats[symbol]) {
        tokenStats[symbol] = {
          buys: 0,
          sells: 0,
          buyVolume: 0,
          sellVolume: 0,
          buyHIVE: 0,
          sellHIVE: 0
        };
      }

      if (isBuyer) {
        tokenStats[symbol].buys++;
        tokenStats[symbol].buyVolume += parseFloat(trade.quantity);
        tokenStats[symbol].buyHIVE += parseFloat(trade.price) * parseFloat(trade.quantity);
      } else {
        tokenStats[symbol].sells++;
        tokenStats[symbol].sellVolume += parseFloat(trade.quantity);
        tokenStats[symbol].sellHIVE += parseFloat(trade.price) * parseFloat(trade.quantity);
      }
    });

    console.log('\n📊 BY TOKEN:\n');
    Object.entries(tokenStats)
      .sort((a, b) => (b[1].buys + b[1].sells) - (a[1].buys + a[1].sells))
      .forEach(([symbol, stats]) => {
        console.log(`${symbol}:`);
        console.log(`   Buys: ${stats.buys} (${stats.buyVolume.toFixed(4)} tokens, ${stats.buyHIVE.toFixed(4)} HIVE spent)`);
        console.log(`   Sells: ${stats.sells} (${stats.sellVolume.toFixed(4)} tokens, ${stats.sellHIVE.toFixed(4)} HIVE received)`);

        const netTokens = stats.buyVolume - stats.sellVolume;
        const netHIVE = stats.sellHIVE - stats.buyHIVE;

        console.log(`   Net position: ${netTokens >= 0 ? '+' : ''}${netTokens.toFixed(4)} tokens`);
        console.log(`   Net P/L: ${netHIVE >= 0 ? '✅ +' : '❌ '}${netHIVE.toFixed(4)} HIVE`);
        console.log('');
      });

    // Total P/L
    const totalBuyHIVE = buys.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
    const totalSellHIVE = sells.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
    const netPL = totalSellHIVE - totalBuyHIVE;

    console.log('='.repeat(80));
    console.log(`TOTAL HIVE SPENT (Buys): ${totalBuyHIVE.toFixed(4)} HIVE`);
    console.log(`TOTAL HIVE RECEIVED (Sells): ${totalSellHIVE.toFixed(4)} HIVE`);
    console.log(`NET P/L: ${netPL >= 0 ? '✅ +' : '❌ '}${netPL.toFixed(4)} HIVE`);
    console.log('='.repeat(80));
  }

  console.log('\n✅ Report complete!\n');
}

// Run
main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
