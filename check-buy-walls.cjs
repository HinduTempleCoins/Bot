#!/usr/bin/env node

const { execSync } = require('child_process');

const ACCOUNT = 'angelicalist';
const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");
  const cmd = `curl -s -X POST ${HIVE_ENGINE_RPC} -H "Content-Type: application/json" -d '${escaped}'`;
  const output = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(output);
}

async function main() {
  console.log('\n📊 Checking buy wall liquidity for wallet tokens...\n');

  // Get wallet balances
  const balances = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account: ACCOUNT },
      limit: 1000,
      offset: 0,
      indexes: []
    }
  });

  const tokens = (balances.result || [])
    .filter(b => parseFloat(b.balance) > 0)
    .filter(b => b.symbol !== 'SWAP.HIVE');

  console.log(`Found ${tokens.length} tokens in wallet\n`);

  let blockedCount = 0;
  let wouldSellCount = 0;

  for (const token of tokens) {
    const symbol = token.symbol;
    const balance = parseFloat(token.balance);

    // Get buy orders
    const buyOrders = apiCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'buyBook',
        query: { symbol },
        limit: 20
      }
    });

    const orders = buyOrders.result || [];
    const totalLiquidity = orders.reduce((sum, order) =>
      sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
    );

    const threshold5 = totalLiquidity >= 5.0;
    const threshold1 = totalLiquidity >= 1.0;
    const threshold01 = totalLiquidity >= 0.1;

    let status;
    if (threshold5) {
      status = '✅ 5+ HIVE';
      wouldSellCount++;
    } else if (threshold1) {
      status = '⚠️  1-5 HIVE';
      blockedCount++;
    } else if (threshold01) {
      status = '⚠️  0.1-1 HIVE';
      blockedCount++;
    } else {
      status = '❌ < 0.1 HIVE';
      blockedCount++;
    }

    console.log(`${symbol.padEnd(12)} | Balance: ${balance.toFixed(4).padStart(10)} | Buy wall: ${totalLiquidity.toFixed(4).padStart(8)} HIVE | ${status}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`With 5 HIVE threshold: ${wouldSellCount} would sell, ${blockedCount} would be BLOCKED`);
  console.log('='.repeat(80) + '\n');
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
