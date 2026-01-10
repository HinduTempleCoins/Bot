#!/usr/bin/env node

const { execSync } = require('child_process');

const ACCOUNT = process.argv[2] || 'angelicalist';
const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

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

console.log(`\n💰 CHECKING BALANCES FOR @${ACCOUNT}\n`);

// Get token balances
const payload = {
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
};

const result = apiCall(payload);

if (!result.result || result.result.length === 0) {
  console.log('⚠️  No token balances found\n');
  process.exit(0);
}

console.log(`Found ${result.result.length} tokens:\n`);

result.result
  .sort((a, b) => b.balance - a.balance)
  .forEach((token, index) => {
    console.log(`${index + 1}. ${token.symbol}: ${token.balance}`);
    if (token.stake && parseFloat(token.stake) > 0) {
      console.log(`   Staked: ${token.stake}`);
    }
    if (token.pendingUnstake && parseFloat(token.pendingUnstake) > 0) {
      console.log(`   Pending Unstake: ${token.pendingUnstake}`);
    }
  });

console.log('\n');
