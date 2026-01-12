#!/usr/bin/env node

// ========================================
// GIFT SCANNER - KaliVanKush Seed Capital Tracker
// ========================================
// Identifies tokens received from @KaliVanKush
// These are seed capital that needs strategic liquidation

const { execSync } = require('child_process');
const fs = require('fs');

const CONFIG = {
  ACCOUNT: 'angelicalist',
  GIFT_SENDER: 'kalivankush',
  API: 'https://api.hive-engine.com/rpc/contracts',
  CACHE_FILE: './gift-tokens-cache.json',
  CACHE_DURATION: 3600000 // 1 hour
};

function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");
  const cmd = `curl -s -X POST ${CONFIG.API} -H "Content-Type: application/json" -d '${escaped}'`;
  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(output);
}

/**
 * Get all transfers received from @KaliVanKush
 */
function getGiftTransfers(limit = 1000) {
  console.log(`\n🎁 Scanning for gifts from @${CONFIG.GIFT_SENDER}...`);

  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'transfers',
      query: {
        from: CONFIG.GIFT_SENDER,
        to: CONFIG.ACCOUNT
      },
      limit,
      offset: 0,
      indexes: []
    }
  });

  const transfers = result.result || [];
  console.log(`   Found ${transfers.length} gift transfers`);

  return transfers;
}

/**
 * Classify tokens as gifts (seed capital) or acquired (trading)
 */
function classifyWalletTokens() {
  console.log('\n📊 Classifying wallet tokens...');

  // Get all gift transfers
  const giftTransfers = getGiftTransfers();

  // Group by symbol
  const giftTokens = {};
  for (const transfer of giftTransfers) {
    const symbol = transfer.symbol;
    if (!giftTokens[symbol]) {
      giftTokens[symbol] = {
        symbol,
        totalReceived: 0,
        transfers: []
      };
    }

    giftTokens[symbol].totalReceived += parseFloat(transfer.quantity);
    giftTokens[symbol].transfers.push({
      quantity: parseFloat(transfer.quantity),
      timestamp: transfer.timestamp,
      memo: transfer.memo || ''
    });
  }

  // Get current wallet balances
  const balancesResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account: CONFIG.ACCOUNT },
      limit: 1000,
      indexes: []
    }
  });

  const balances = balancesResult.result || [];

  // Classify each token
  const classification = {
    giftTokens: [], // Tokens received from @KaliVanKush (seed capital)
    tradingTokens: [], // Tokens acquired through trading
    timestamp: Date.now()
  };

  for (const balance of balances) {
    if (balance.symbol === 'SWAP.HIVE') continue; // Skip HIVE

    const currentBalance = parseFloat(balance.balance);
    if (currentBalance === 0) continue;

    const isGift = giftTokens.hasOwnProperty(balance.symbol);

    if (isGift) {
      classification.giftTokens.push({
        symbol: balance.symbol,
        balance: currentBalance,
        receivedFrom: CONFIG.GIFT_SENDER,
        totalGifted: giftTokens[balance.symbol].totalReceived,
        transferCount: giftTokens[balance.symbol].transfers.length,
        liquidationStrategy: 'STRATEGIC' // Will be determined by market conditions
      });
    } else {
      classification.tradingTokens.push({
        symbol: balance.symbol,
        balance: currentBalance,
        source: 'TRADING',
        strategy: 'MICRO_DANCE' // Normal profit strategies
      });
    }
  }

  console.log(`\n✅ Classification complete:`);
  console.log(`   🎁 Gift tokens (seed capital): ${classification.giftTokens.length}`);
  console.log(`   💰 Trading tokens: ${classification.tradingTokens.length}`);

  // Display gift tokens
  if (classification.giftTokens.length > 0) {
    console.log(`\n🎁 SEED CAPITAL (from @${CONFIG.GIFT_SENDER}):`);
    for (const token of classification.giftTokens) {
      console.log(`   ${token.symbol}: ${token.balance.toFixed(8)} (gifted: ${token.totalGifted.toFixed(8)})`);
    }
  }

  // Display trading tokens
  if (classification.tradingTokens.length > 0) {
    console.log(`\n💰 TRADING TOKENS (acquired by bot):`);
    for (const token of classification.tradingTokens) {
      console.log(`   ${token.symbol}: ${token.balance.toFixed(8)}`);
    }
  }

  // Cache the classification
  fs.writeFileSync(CONFIG.CACHE_FILE, JSON.stringify(classification, null, 2));
  console.log(`\n💾 Cached to ${CONFIG.CACHE_FILE}`);

  return classification;
}

/**
 * Get cached classification if recent, otherwise regenerate
 */
function getTokenClassification(forceRefresh = false) {
  if (!forceRefresh && fs.existsSync(CONFIG.CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CONFIG.CACHE_FILE, 'utf8'));
      const age = Date.now() - cached.timestamp;

      if (age < CONFIG.CACHE_DURATION) {
        console.log(`📋 Using cached classification (${Math.floor(age / 60000)} minutes old)`);
        return cached;
      }
    } catch (error) {
      console.log('⚠️ Cache read error, regenerating...');
    }
  }

  return classifyWalletTokens();
}

/**
 * Check if a token is a gift (seed capital)
 */
function isGiftToken(symbol) {
  const classification = getTokenClassification();
  return classification.giftTokens.some(t => t.symbol === symbol);
}

// Run if called directly
if (require.main === module) {
  const forceRefresh = process.argv.includes('--refresh');
  classifyWalletTokens();
}

module.exports = {
  getTokenClassification,
  isGiftToken,
  classifyWalletTokens
};
