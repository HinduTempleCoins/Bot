// test-fakes.mjs — OFFLINE fake network for the helperbot tests. One injectable fetch that answers the
// MELEK JSON-RPC, PRANA JSON-RPC (eth_*), pranascan (Blockscout v2), Hive-Engine, MELEK-Engine, the pool
// API, the faucets and the flows map from a mutable in-memory `state`. Unknown URLs → 404. Never touches
// the network. (Not a test file itself — imported by the *.test.mjs files.)

const hex = (n) => '0x' + BigInt(n).toString(16);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const E18 = 10n ** 18n;

export const wei = (n, dec = 18) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** BigInt(dec) / 1_000_000n;

export function baseState() {
  return {
    calls: [],
    melek: {
      mainnet: {
        dgp: { head_block_number: 1_000_000, virtual_supply: '2000000.000 MELEK', current_supply: '2000000.000 MELEK', current_sbd_supply: '0.000 MBD', total_vesting_fund_steem: '250000.000 MELEK', total_vesting_shares: '700.000000 VESTS', content_reward_percent: 5000, vesting_reward_percent: 1500, sps_fund_percent: 1000 },
        cfg: { STEEM_INFLATION_RATE_START_PERCENT: 978, STEEM_INFLATION_RATE_STOP_PERCENT: 95, STEEM_INFLATION_NARROWING_PERIOD: 250000, STEEM_BLOCK_INTERVAL: 4 },
        extra: {},
        accounts: { 'wmelek-bridge': { name: 'wmelek-bridge', balance: '0.900 MELEK', vesting_shares: '0.000000 VESTS', post_count: 0 } },
        count: 87,
        history: {},
        witnesses: {},
      },
      testnet: {
        dgp: { head_block_number: 500_000, virtual_supply: '1000.000 TESTS', current_supply: '1000.000 TESTS', current_sbd_supply: '0.000 TBD', total_vesting_fund_steem: '100.000 TESTS', total_vesting_shares: '100.000000 VESTS', content_reward_percent: 5000, vesting_reward_percent: 1500, sps_fund_percent: 1000 },
        cfg: { STEEM_INFLATION_RATE_START_PERCENT: 978, STEEM_INFLATION_RATE_STOP_PERCENT: 95, STEEM_INFLATION_NARROWING_PERIOD: 250000, STEEM_BLOCK_INTERVAL: 3 },
        accounts: {}, count: 10, history: {}, witnesses: {}, extra: {},
      },
    },
    prana: {
      mainnet: { chainId: 712217, block: 167_000, native: {}, nonce: {}, supply: {}, cap: {}, bal: {}, pairs: {}, reserves: {}, token0: {} },
      alpha: { chainId: 108369, block: 9_000, native: {}, nonce: {}, supply: {}, cap: {}, bal: {}, pairs: {}, reserves: {}, token0: {} },
    },
    scan: { stats: { average_block_time: 15000, total_addresses: '101' }, tokens: {}, txs: {} },
    he: { tokens: {}, metrics: {}, balances: [] },
    engine: { tokens: [], balances: {} },
    pool: {},
    faucet: { page: '<title>PRANA Faucet</title><button>Get test PRANA</button>', drip: { ok: true, txHash: '0xfeed', amount: 5 }, mainnetHealth: { ok: true, mainnet: true, creator: 'onboarder' }, testnetHealth: { ok: true, testnet: true, creator: 'hathor' } },
    flows: null,
    down: new Set(), // hostnames to simulate as unreachable
  };
}

function res(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

function melekRpc(st, net, method, params) {
  const m = st.melek[net];
  switch (method) {
    case 'condenser_api.get_dynamic_global_properties': return m.dgp;
    case 'condenser_api.get_config': return m.cfg;
    case 'condenser_api.get_account_count': return m.count;
    case 'condenser_api.get_accounts': return params[0].map((n) => m.accounts[n]).filter(Boolean);
    case 'condenser_api.get_account_history': return m.history[params[0]] || [];
    case 'condenser_api.get_witness_by_account': return m.witnesses[params[0]] || null;
    default: {
      const e = m.extra && m.extra[method];
      return typeof e === 'function' ? e(params) : e;
    }
  }
}

function pranaRpc(st, net, method, params) {
  const p = st.prana[net];
  const lc = (a) => String(a).toLowerCase();
  switch (method) {
    case 'eth_chainId': return hex(p.chainId);
    case 'eth_blockNumber': return hex(p.block);
    case 'eth_getBalance': return hex(p.native[lc(params[0])] || 0n);
    case 'eth_getTransactionCount': return hex(p.nonce[lc(params[0])] || 0);
    case 'eth_call': {
      const to = lc(params[0].to);
      const d = String(params[0].data);
      const sel = d.slice(0, 10);
      if (sel === '0x18160ddd') return p.supply[to] !== undefined ? '0x' + word(p.supply[to]) : { revert: true };
      if (sel === '0x355274ea') return p.cap[to] !== undefined ? '0x' + word(p.cap[to]) : { revert: true };
      if (sel === '0x70a08231') { const who = '0x' + d.slice(-40); return '0x' + word((p.bal[to] || {})[lc(who)] || 0n); }
      if (sel === '0xe6a43905') {
        const a = '0x' + d.slice(34, 74); const b = '0x' + d.slice(98, 138);
        const k = [lc(a), lc(b)].sort().join('|');
        return '0x' + addrWord(p.pairs[k] || '0x0000000000000000000000000000000000000000');
      }
      if (sel === '0x0dfe1681') return '0x' + addrWord(p.token0[to]);
      if (sel === '0x0902f1ac') { const r = p.reserves[to]; return r ? '0x' + word(r[0]) + word(r[1]) + word(0) : { revert: true }; }
      return { revert: true };
    }
    default: return undefined;
  }
}

export function fakeFetch(st) {
  return async (url, init = {}) => {
    const u = new URL(url);
    st.calls.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    if (st.down.has(u.host)) throw new Error('ECONNREFUSED');
    const body = init.body ? JSON.parse(init.body) : null;

    // JSON-RPC endpoints
    const melekNet = { 'melek.salon': 'mainnet', 'wallet.melek.salon': 'mainnet', 'alpha.melek.salon': 'testnet' }[u.host];
    if (melekNet && u.pathname === '/rpc' && body) {
      const r = melekRpc(st, melekNet, body.method, body.params);
      if (r && r.__rpcError) return res(200, { jsonrpc: '2.0', id: 1, error: { code: -32003, message: r.__rpcError } });
      return r === undefined ? res(200, { jsonrpc: '2.0', id: 1, error: { message: 'unknown' } }) : res(200, { jsonrpc: '2.0', id: 1, result: r });
    }
    const pranaNet = { 'rpc.prana.melek.salon': 'mainnet', 'rpc.prana.alpha.melek.salon': 'alpha' }[u.host];
    if (pranaNet && body) {
      const r = pranaRpc(st, pranaNet, body.method, body.params);
      if (r && r.revert) return res(200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } });
      return r === undefined ? res(200, { jsonrpc: '2.0', id: 1, error: { message: 'unknown' } }) : res(200, { jsonrpc: '2.0', id: 1, result: r });
    }
    if (u.host === 'api.hive-engine.com' && body) {
      const { contract, table, query } = body.params;
      if (contract === 'tokens' && table === 'tokens') return res(200, { result: st.he.tokens[query.symbol] ? [st.he.tokens[query.symbol]] : [] });
      if (contract === 'market' && table === 'metrics') return res(200, { result: st.he.metrics[query.symbol] ? [st.he.metrics[query.symbol]] : [] });
      if (contract === 'tokens' && table === 'balances') return res(200, { result: st.he.balances.filter((b) => b.symbol === query.symbol && (!query.account || b.account === query.account)) });
      return res(200, { result: [] });
    }
    // REST
    if (u.host === 'pranascan.soapbox.community' || u.host === 'pranascan.alpha.soapbox.community') {
      if (u.pathname === '/api/v2/stats') return res(200, st.scan.stats);
      let m = u.pathname.match(/^\/api\/v2\/tokens\/(0x[0-9a-fA-F]{40})$/);
      if (m) return st.scan.tokens[m[1].toLowerCase()] ? res(200, st.scan.tokens[m[1].toLowerCase()]) : res(404, {});
      m = u.pathname.match(/^\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/transactions$/);
      if (m) return res(200, { items: st.scan.txs[m[1].toLowerCase()] || [] });
    }
    if (u.host === 'engine.melek.salon') {
      if (u.pathname === '/api/tokens') return res(200, st.engine.tokens);
      if (u.pathname === '/api/balances') { const k = `${u.searchParams.get('account')}|${u.searchParams.get('symbol')}`; return res(200, st.engine.balances[k] !== undefined ? [{ balance: String(st.engine.balances[k]), stake: '0' }] : []); }
    }
    if (u.host === 'pool.soapbox.community') {
      const m = u.pathname.match(/^\/api\/pools\/([^/]+)\/miners\/(.+)$/);
      if (m) return res(200, st.pool[`${m[1]}|${decodeURIComponent(m[2])}`] || { pendingShares: 0, pendingBalance: 0, totalPaid: 0, performanceSamples: [] });
    }
    if (u.host === 'faucet.alpha.soapbox.community') {
      if (u.pathname === '/' && (!init.method || init.method === 'GET')) return res(200, st.faucet.page);
      if (u.pathname === '/api/drip') return res(st.faucet.drip.ok ? 200 : 400, st.faucet.drip);
    }
    if (u.host === 'melek.salon' && u.pathname === '/faucet/health') return res(200, st.faucet.mainnetHealth);
    if (u.host === 'alpha.melek.salon' && u.pathname === '/faucet/health') return res(200, st.faucet.testnetHealth);
    if (u.host === 'melek.salon' && u.pathname === '/map/flows.json') return st.flows ? res(200, st.flows) : res(404, {});
    return res(404, { error: 'not found' });
  };
}

export { E18, hex };
