// ========================================
// HIVE-ENGINE API WRAPPER (Using curl)
// ========================================
// Purpose: Reliable API calls using curl (axios has issues)
// Author: Claude Code
// Date: 2026-01-10

const { execSync } = require('child_process');

const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

/**
 * Make a HIVE-Engine API call using curl
 * @param {Object} payload - JSON-RPC payload
 * @returns {Promise<Object>} API response
 */
async function apiCall(payload) {
  try {
    const jsonPayload = JSON.stringify(payload);
    const escaped = jsonPayload.replace(/'/g, "'\\''");

    const cmd = `curl -s -X POST ${HIVE_ENGINE_RPC} \
      -H "Content-Type: application/json" \
      -d '${escaped}'`;

    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const response = JSON.parse(output);

    return response;
  } catch (error) {
    throw new Error(`API call failed: ${error.message}`);
  }
}

/**
 * Get token balances for an account
 */
async function getAccountBalances(account) {
  const response = await apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account },
      limit: 1000
    }
  });

  return response.result || [];
}

/**
 * Get buy orders (bid book)
 */
async function getBuyBook(symbol, limit = 100) {
  const response = await apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit
    }
  });

  return response.result || [];
}

/**
 * Get sell orders (ask book)
 */
async function getSellBook(symbol, limit = 100) {
  const response = await apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'sellBook',
      query: { symbol },
      limit
    }
  });

  return response.result || [];
}

/**
 * Get market metrics
 */
async function getMarketMetrics(symbol) {
  const response = await apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'findOne',
    params: {
      contract: 'market',
      table: 'metrics',
      query: { symbol }
    }
  });

  return response.result || null;
}

/**
 * Get order book (both bids and asks)
 */
async function getOrderBook(symbol, limit = 100) {
  const [bids, asks] = await Promise.all([
    getBuyBook(symbol, limit),
    getSellBook(symbol, limit)
  ]);

  return { bids, asks };
}

module.exports = {
  apiCall,
  getAccountBalances,
  getBuyBook,
  getSellBook,
  getMarketMetrics,
  getOrderBook
};
