#!/usr/bin/env node

const { execSync } = require('child_process');

const ACCOUNT = 'angelicalist';
const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

/**
 * Make API call using curl (proven reliable method)
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
 * Get recent token transfer history
 */
async function getTransferHistory(account, limit = 50) {
  console.log(`\n📨 CHECKING HIVE-ENGINE TRANSFERS FOR @${account}`);
  console.log('='.repeat(60));

  try {
    // Query transfer history from HIVE-Engine
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'transfers',
        query: {
          $or: [
            { from: account },
            { to: account }
          ]
        },
        limit: limit,
        offset: 0,
        indexes: []
      }
    };

    const result = apiCall(payload);

    if (!result.result || result.result.length === 0) {
      console.log('\n⚠️  No recent transfers found');
      return [];
    }

    const transfers = result.result
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first

    console.log(`\n✅ Found ${transfers.length} transfers:\n`);

    transfers.forEach((tx, index) => {
      const direction = tx.to === account ? '📥 RECEIVED' : '📤 SENT';
      const counterparty = tx.to === account ? tx.from : tx.to;

      console.log(`${index + 1}. ${direction} ${tx.quantity} ${tx.symbol}`);
      console.log(`   ${tx.to === account ? 'From' : 'To'}: @${counterparty}`);

      // Convert Unix timestamp to readable date
      const date = new Date(tx.timestamp * 1000).toISOString();
      console.log(`   Time: ${date}`);

      if (tx.memo && tx.memo.trim()) {
        console.log(`   📝 MEMO: "${tx.memo}"`);
      } else {
        console.log(`   📝 MEMO: (none)`);
      }

      console.log(`   Block: ${tx.blockNumber}`);
      console.log('');
    });

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));

    const received = transfers.filter(tx => tx.to === account);
    const sent = transfers.filter(tx => tx.from === account);
    const withMemo = transfers.filter(tx => tx.memo && tx.memo.trim());

    console.log(`Total transfers: ${transfers.length}`);
    console.log(`Received: ${received.length}`);
    console.log(`Sent: ${sent.length}`);
    console.log(`With memos: ${withMemo.length}`);

    // Token breakdown
    const tokenCounts = {};
    transfers.forEach(tx => {
      const key = `${tx.symbol} (${tx.to === account ? 'in' : 'out'})`;
      tokenCounts[key] = (tokenCounts[key] || 0) + parseFloat(tx.quantity);
    });

    console.log('\n📊 By Token:');
    Object.entries(tokenCounts).forEach(([token, amount]) => {
      console.log(`   ${token}: ${amount.toFixed(8)}`);
    });

    console.log('\n✅ Complete!\n');

    return transfers;

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 50;
  getTransferHistory(ACCOUNT, limit).catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { getTransferHistory };
