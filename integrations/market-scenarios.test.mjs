// market-scenarios.test.mjs — offline verification of scenarios() in market-scenarios.mjs.
// Drives the whole stack (scenarios → hive-engine-market → he-client.find/findOne → fetch) through
// the injectable __setFetch seam on ./he-client.mjs, with canned JSON-RPC rows for the three tables
// touched: 'tokens/tokens' (tokenInfo), 'market/metrics' (metrics), 'market/sellBook' (sellBook).
// hiveUsd is PASSED in opts so the price oracle (network) is never called. Fully offline, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from './market-scenarios.mjs';
import { __setFetch } from './he-client.mjs';

// ── canned sidechain state ────────────────────────────────────────────────
// Two tokens with deliberately THIN ask books (the real-world condition the tool surfaces): a budget
// clears the whole book and most of it can't deploy. Books are ascending by price (sellBook order).
const TOKENS = {
  VKBT: {
    info: { symbol: 'VKBT', circulatingSupply: '1000000', issuer: 'hathor' },
    metrics: { symbol: 'VKBT', lastPrice: '0.0010' },
    sellBook: [
      { price: '0.0012', quantity: '500' },
      { price: '0.0020', quantity: '300' },
      { price: '0.0050', quantity: '100' },
    ],
  },
  CURE: {
    info: { symbol: 'CURE', circulatingSupply: '2000000', issuer: 'hathor' },
    metrics: { symbol: 'CURE', lastPrice: '0.0005' },
    sellBook: [
      { price: '0.0006', quantity: '1000' },
      { price: '0.0009', quantity: '400' },
    ],
  },
};

const HIVE_USD = 0.30;

// JSON-RPC `find` fetch double: inspect the POST body's {contract, table, query.symbol} and return
// the matching canned rows. findOne calls find with limit 1, so tokenInfo/metrics get [row], sellBook
// gets the full array. Anything unknown → empty result (soft, like a missing token).
function cannedFetch() {
  return async (_url, opts = {}) => {
    const body = JSON.parse(opts.body || '{}');
    const { contract, table, query } = body.params || {};
    const sym = query && query.symbol;
    const tok = TOKENS[sym];
    let result = [];
    if (tok) {
      if (contract === 'tokens' && table === 'tokens') result = [tok.info];
      else if (contract === 'market' && table === 'metrics') result = [tok.metrics];
      else if (contract === 'market' && table === 'sellBook') result = tok.sellBook;
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

test('returns exactly n scenarios and echoes token fields', async () => {
  __setFetch(cannedFetch());
  try {
    const n = 7;
    const out = await scenarios(['VKBT', 'CURE'], { n, seed: 42, hiveUsd: HIVE_USD });

    assert.equal(out.scenarios.length, n, 'exactly n scenarios');
    assert.equal(out.hiveUsd, HIVE_USD, 'passed-in hiveUsd is echoed (oracle never called)');

    // tokens[] echoes lastUsd / bookValueUsd / supply derived from the canned rows
    assert.equal(out.tokens.length, 2);
    const vkbt = out.tokens.find(t => t.symbol === 'VKBT');
    const cure = out.tokens.find(t => t.symbol === 'CURE');

    assert.equal(vkbt.supply, 1000000, 'supply echoed from circulatingSupply');
    assert.equal(cure.supply, 2000000);

    // lastUsd = lastPrice * hiveUsd  (0.0010 * 0.30 = 0.0003)
    assert.equal(vkbt.lastUsd, +(0.0010 * HIVE_USD).toFixed(8));
    assert.equal(cure.lastUsd, +(0.0005 * HIVE_USD).toFixed(8));

    // bookValueUsd = sum(price*qty) * hiveUsd
    const vkbtBookHive = 0.0012 * 500 + 0.0020 * 300 + 0.0050 * 100;
    assert.equal(vkbt.bookValueUsd, +(vkbtBookHive * HIVE_USD).toFixed(2));
    const cureBookHive = 0.0006 * 1000 + 0.0009 * 400;
    assert.equal(cure.bookValueUsd, +(cureBookHive * HIVE_USD).toFixed(2));
  } finally {
    __setFetch(null); // restore real fetch
  }
});

test('same seed → byte-identical JSON (deterministic PRNG)', async () => {
  __setFetch(cannedFetch());
  try {
    const a = await scenarios(['VKBT', 'CURE'], { n: 10, seed: 1234, hiveUsd: HIVE_USD });
    const b = await scenarios(['VKBT', 'CURE'], { n: 10, seed: 1234, hiveUsd: HIVE_USD });
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'identical seed yields identical output');

    // and a different seed yields different arrangements (sanity: PRNG actually varies)
    const c = await scenarios(['VKBT', 'CURE'], { n: 10, seed: 9999, hiveUsd: HIVE_USD });
    assert.notEqual(JSON.stringify(a), JSON.stringify(c), 'different seed yields different output');
  } finally {
    __setFetch(null);
  }
});

test('every scenario deploys no more than its budget', async () => {
  __setFetch(cannedFetch());
  try {
    const out = await scenarios(['VKBT', 'CURE'], { n: 25, seed: 7, hiveUsd: HIVE_USD });
    for (const sc of out.scenarios) {
      assert.ok(
        sc.totalDeployedUsd <= sc.budgetUsd + 1e-6,
        `totalDeployedUsd ${sc.totalDeployedUsd} must be <= budgetUsd ${sc.budgetUsd}`,
      );
      // deployed + undeployed should track the budget (per-leg accounting is internally consistent)
      assert.ok(sc.totalDeployedUsd >= 0, 'non-negative deployment');
      assert.equal(sc.legs.length, 2, 'one leg per token');
    }
  } finally {
    __setFetch(null);
  }
});

test('edge: unknown symbols are filtered out, scenarios still produced', async () => {
  __setFetch(cannedFetch());
  try {
    // NOPE has no canned rows → bookOf returns null → filtered. Only VKBT survives.
    const out = await scenarios(['VKBT', 'NOPE'], { n: 5, seed: 3, hiveUsd: HIVE_USD });
    assert.equal(out.tokens.length, 1, 'only the known token survives');
    assert.equal(out.tokens[0].symbol, 'VKBT');
    assert.equal(out.scenarios.length, 5, 'still exactly n scenarios');
    for (const sc of out.scenarios) {
      assert.equal(sc.legs.length, 1, 'one leg for the one surviving token');
      assert.ok(sc.totalDeployedUsd <= sc.budgetUsd + 1e-6);
    }
  } finally {
    __setFetch(null);
  }
});

test('edge: no known symbols → zero tokens, n empty-leg scenarios, still deterministic', async () => {
  __setFetch(cannedFetch());
  try {
    const a = await scenarios(['NOPE', 'ALSONOPE'], { n: 4, seed: 8, hiveUsd: HIVE_USD });
    const b = await scenarios(['NOPE', 'ALSONOPE'], { n: 4, seed: 8, hiveUsd: HIVE_USD });
    assert.equal(a.tokens.length, 0);
    assert.equal(a.scenarios.length, 4);
    for (const sc of a.scenarios) {
      assert.equal(sc.legs.length, 0, 'no legs when no books');
      assert.equal(sc.totalDeployedUsd, 0, 'nothing deploys with no books');
      assert.ok(sc.totalDeployedUsd <= sc.budgetUsd + 1e-6);
    }
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic even with empty books');
  } finally {
    __setFetch(null);
  }
});
