#!/usr/bin/env node

const dhive = require('@hiveio/dhive');

// HIVE API connection
const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.deathwing.me',
  'https://rpc.ausbit.dev'
]);

const ACCOUNT = 'angelicalist';

/**
 * Read recent account history with transfer memos
 */
async function readTransferHistory(limit = 50) {
  console.log(`\n📨 READING TRANSFER HISTORY FOR @${ACCOUNT}`);
  console.log('='.repeat(60));

  try {
    // Get account history (limit -1 means most recent transactions)
    const history = await client.database.getAccountHistory(
      ACCOUNT,
      -1,      // Start from most recent
      limit    // Number of operations to fetch
    );

    // Filter for transfers only
    const transfers = history
      .filter(op => {
        const [opType] = op[1].op;
        return opType === 'transfer';
      })
      .map(op => {
        const [opType, opData] = op[1].op;
        const timestamp = op[1].timestamp;
        return {
          timestamp,
          from: opData.from,
          to: opData.to,
          amount: opData.amount,
          memo: opData.memo,
          txId: op[1].trx_id
        };
      })
      .reverse(); // Show newest first

    if (transfers.length === 0) {
      console.log('\n⚠️  No transfers found in recent history');
      return [];
    }

    console.log(`\n✅ Found ${transfers.length} transfers:\n`);

    // Display transfers
    transfers.forEach((tx, index) => {
      const direction = tx.to === ACCOUNT ? '📥 RECEIVED' : '📤 SENT';
      const counterparty = tx.to === ACCOUNT ? tx.from : tx.to;

      console.log(`${index + 1}. ${direction} ${tx.amount}`);
      console.log(`   ${tx.to === ACCOUNT ? 'From' : 'To'}: @${counterparty}`);
      console.log(`   Time: ${tx.timestamp}`);

      if (tx.memo && tx.memo.trim()) {
        console.log(`   📝 MEMO: "${tx.memo}"`);
      } else {
        console.log(`   📝 MEMO: (none)`);
      }

      console.log(`   TxID: ${tx.txId}`);
      console.log('');
    });

    return transfers;

  } catch (error) {
    console.error('❌ Error reading transfer history:', error.message);
    throw error;
  }
}

/**
 * Read HIVE-Engine token transfer history
 */
async function readHiveEngineTransfers(limit = 50) {
  console.log(`\n🔷 READING HIVE-ENGINE TOKEN TRANSFERS FOR @${ACCOUNT}`);
  console.log('='.repeat(60));

  try {
    // Get account history
    const history = await client.database.getAccountHistory(
      ACCOUNT,
      -1,
      limit
    );

    // Filter for custom_json operations with HIVE-Engine transfers
    const heTransfers = history
      .filter(op => {
        const [opType, opData] = op[1].op;
        if (opType !== 'custom_json') return false;

        // Check if it's a HIVE-Engine transfer
        if (opData.id !== 'ssc-mainnet-hive') return false;

        try {
          const json = JSON.parse(opData.json);
          return json.contractName === 'tokens' &&
                 json.contractAction === 'transfer';
        } catch {
          return false;
        }
      })
      .map(op => {
        const [opType, opData] = op[1].op;
        const timestamp = op[1].timestamp;
        const json = JSON.parse(opData.json);

        return {
          timestamp,
          from: json.contractPayload.from,
          to: json.contractPayload.to,
          symbol: json.contractPayload.symbol,
          quantity: json.contractPayload.quantity,
          memo: json.contractPayload.memo || '',
          txId: op[1].trx_id
        };
      })
      .filter(tx => tx.to === ACCOUNT || tx.from === ACCOUNT)
      .reverse(); // Show newest first

    if (heTransfers.length === 0) {
      console.log('\n⚠️  No HIVE-Engine transfers found in recent history');
      return [];
    }

    console.log(`\n✅ Found ${heTransfers.length} HIVE-Engine token transfers:\n`);

    // Display transfers
    heTransfers.forEach((tx, index) => {
      const direction = tx.to === ACCOUNT ? '📥 RECEIVED' : '📤 SENT';
      const counterparty = tx.to === ACCOUNT ? tx.from : tx.to;

      console.log(`${index + 1}. ${direction} ${tx.quantity} ${tx.symbol}`);
      console.log(`   ${tx.to === ACCOUNT ? 'From' : 'To'}: @${counterparty}`);
      console.log(`   Time: ${tx.timestamp}`);

      if (tx.memo && tx.memo.trim()) {
        console.log(`   📝 MEMO: "${tx.memo}"`);
      } else {
        console.log(`   📝 MEMO: (none)`);
      }

      console.log(`   TxID: ${tx.txId}`);
      console.log('');
    });

    return heTransfers;

  } catch (error) {
    console.error('❌ Error reading HIVE-Engine transfers:', error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 50;

  console.log(`\n🔍 MEMO READER FOR @${ACCOUNT}`);
  console.log(`Checking last ${limit} operations...`);
  console.log('='.repeat(60));

  // Read both HIVE and HIVE-Engine transfers
  const hiveTransfers = await readTransferHistory(limit);
  const heTransfers = await readHiveEngineTransfers(limit);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`HIVE transfers: ${hiveTransfers.length}`);
  console.log(`HIVE-Engine transfers: ${heTransfers.length}`);
  console.log(`Total transfers: ${hiveTransfers.length + heTransfers.length}`);

  // Find transfers with memos
  const hiveMemos = hiveTransfers.filter(tx => tx.memo && tx.memo.trim()).length;
  const heMemos = heTransfers.filter(tx => tx.memo && tx.memo.trim()).length;
  console.log(`\nTransfers with memos: ${hiveMemos + heMemos}`);

  console.log('\n✅ Complete!\n');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  readTransferHistory,
  readHiveEngineTransfers
};
