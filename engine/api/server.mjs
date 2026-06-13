/**
 * server.mjs — Melek-Engine public read API + web UI.
 *
 * REST + JSON-RPC endpoints mirroring Hive-Engine's contracts API shape so
 * existing tooling ports easily, plus a small no-build web UI. Read-only:
 * the API never holds keys and never broadcasts. The "create / issue /
 * transfer" UI page builds the custom_json client-side; the user broadcasts it
 * with their own key (keys never reach the server) — §7 / key-custody rule.
 *
 * Security study §6 E item 12: per-IP rate limit + standard security headers.
 */

import { createServer } from 'node:http';
import { config, genesis } from '../config.mjs';
import { fromBaseUnits } from '../lib/decimal.mjs';
import { renderUI } from '../ui/render.mjs';
import { makeHandler as makeTokenToolsHandler } from '../lib/token-tools.mjs';

const HITS = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  let h = HITS.get(ip);
  if (!h || now > h.resetAt) {
    h = { count: 0, resetAt: now + 60_000 };
    HITS.set(ip, h);
  }
  h.count++;
  return h.count > config.rateLimitPerMin;
}

function send(res, code, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(payload);
}

/** Project a token row for the API (base units -> decimal strings). */
function tokenView(t) {
  return {
    symbol: t.symbol,
    name: t.name,
    issuer: t.issuer,
    precision: t.precision,
    maxSupply: fromBaseUnits(BigInt(t.maxSupply), t.precision),
    supply: fromBaseUnits(BigInt(t.supply), t.precision),
    circulatingSupply: fromBaseUnits(BigInt(t.circulatingSupply), t.precision),
    supplyCapImmutable: t.supplyCapImmutable,
    url: t.url,
    createdBlock: t.createdBlock,
  };
}

function balanceView(state, b) {
  const t = state.findOne('tokens', { symbol: b.symbol });
  const prec = t ? t.precision : 3;
  return {
    account: b.account,
    symbol: b.symbol,
    balance: fromBaseUnits(BigInt(b.balance), prec),
    stake: fromBaseUnits(BigInt(b.stake || '0'), prec),
  };
}

/**
 * Build the HTTP handler over a live State. The engine keeps state fresh in
 * the background; this only reads it.
 */
export function makeHandler(state, opts = {}) {
  // The token-tools surface (engine side-tokens + native SMT/NAI) is mounted at
  // /tools. It reads the same live engine State and, when provided, an injected
  // smtSummary reader (integrations/smt-info.mjs) so the SMT half is live too.
  // It NEVER signs/broadcasts — /tools/api/build only builds + validates ops.
  const tokenTools = makeTokenToolsHandler({ state, smtSummary: opts.smtSummary });

  return function handler(req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (rateLimited(ip)) return send(res, 429, { error: 'rate limited' });

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const q = url.searchParams;

    // --- token tools (mounted under /tools, prefix stripped before delegating) ---
    if (path === '/tools' || path === '/tools/' || path.startsWith('/tools/')) {
      const sub = path === '/tools' ? '/' : path.slice('/tools'.length) || '/';
      const subReq = Object.create(req);
      subReq.url = sub + url.search;
      return tokenTools(subReq, res);
    }

    try {
      // --- health ---
      if (path === '/health') {
        return send(res, 200, {
          ok: true,
          lastBlock: state.meta.lastBlock,
          stateHash: state.meta.stateHash,
          sidechainId: config.sidechainId,
        });
      }

      // --- chain status / state checkpoint (§6 C item 7) ---
      if (path === '/status' || path === '/api/status') {
        return send(res, 200, {
          sidechainId: config.sidechainId,
          chainId: config.chainId,
          lastBlock: state.meta.lastBlock,
          lastBlockId: state.meta.lastBlockId,
          stateHash: state.hash(),
          feeToken: genesis.feeToken,
          minerToken: genesis.minerToken,
          tokenCount: state.collection('tokens').length,
          seams: {
            gateway: config.seams.gateway.enabled,
            dexSettlement: config.seams.dexSettlement.enabled,
          },
        });
      }

      // --- contracts API (Hive-Engine shape) ---
      // GET /contracts/tokens?symbol=APIS   -> token(s)
      if (path === '/contracts/tokens' || path === '/api/tokens') {
        const symbol = q.get('symbol');
        const rows = symbol
          ? state.find('tokens', { symbol: symbol.toUpperCase() })
          : state.collection('tokens');
        return send(res, 200, rows.map(tokenView));
      }

      // GET /contracts/balances?account=hathor[&symbol=APIS]
      if (path === '/contracts/balances' || path === '/api/balances') {
        const account = q.get('account');
        const symbol = q.get('symbol');
        if (!account) return send(res, 400, { error: 'account required' });
        const query = { account };
        if (symbol) query.symbol = symbol.toUpperCase();
        const rows = state.find('balances', query).filter((b) => BigInt(b.balance) > 0n || BigInt(b.stake || '0') > 0n);
        return send(res, 200, rows.map((b) => balanceView(state, b)));
      }

      // GET /contracts/holders?symbol=APIS   -> who holds a token
      if (path === '/contracts/holders' || path === '/api/holders') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        if (!symbol) return send(res, 400, { error: 'symbol required' });
        const rows = state
          .find('balances', { symbol })
          .filter((b) => BigInt(b.balance) > 0n || BigInt(b.stake || '0') > 0n);
        return send(res, 200, rows.map((b) => balanceView(state, b)));
      }

      // GET /contracts/issuance?symbol=APIS  -> append-only issuance log
      if (path === '/contracts/issuance' || path === '/api/issuance') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const rows = symbol ? state.find('issuanceLog', { symbol }) : state.collection('issuanceLog');
        return send(res, 200, rows);
      }

      // GET /api/tribes  -> every SCOT reward rule (tribe): symbol, tag, emission, window, split, curve
      if (path === '/contracts/tribes' || path === '/api/tribes') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const rows = symbol ? state.find('rewardRules', { symbol }) : state.collection('rewardRules');
        return send(res, 200, rows);
      }

      // GET /api/payouts?symbol=X[&author=Y]  -> reward posts for a tribe (who earned, paid status).
      // This is the data behind "see the payouts for the tokens of your choosing."
      if (path === '/contracts/payouts' || path === '/api/payouts') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const author = q.get('author');
        let rows = symbol ? state.find('rewardPosts', { symbol }) : state.collection('rewardPosts');
        if (author) rows = rows.filter((r) => r.author === author);
        // newest first; cap
        rows = rows.slice().sort((a, b) => (b.openedBlock || 0) - (a.openedBlock || 0)).slice(0, 200);
        return send(res, 200, rows);
      }

      // GET /contracts/history?account=x  -> processed ops touching account
      if (path === '/contracts/history' || path === '/api/history') {
        const account = q.get('account');
        let rows = state.collection('processed');
        if (account) rows = rows.filter((r) => r.sender === account);
        return send(res, 200, rows.slice(-200));
      }

      // --- JSON-RPC (Hive-Engine "find" shape) ---
      if (path === '/rpc/contracts' && req.method === 'POST') {
        return readBody(req).then((body) => {
          let rpcReq;
          try {
            rpcReq = JSON.parse(body);
          } catch {
            return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' }, id: null });
          }
          const { id = null, params = {} } = rpcReq;
          const { contract, table, query = {} } = params;
          let result = [];
          if (contract === 'tokens' && table === 'tokens') {
            result = state.find('tokens', normSymbol(query)).map(tokenView);
          } else if (contract === 'tokens' && table === 'balances') {
            result = state.find('balances', normSymbol(query)).map((b) => balanceView(state, b));
          }
          return send(res, 200, { jsonrpc: '2.0', result, id });
        });
      }

      // --- UI ---
      if (path === '/' || path === '/index.html') {
        return send(res, 200, renderUI(state), 'text/html; charset=utf-8');
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  };
}

function normSymbol(query) {
  const out = { ...query };
  if (out.symbol) out.symbol = String(out.symbol).toUpperCase();
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

export async function startServer(state) {
  // Best-effort: wire the live SMT/NAI reader into the /tools surface. If the
  // module or RPC env isn't present, /tools still renders (SMT half soft-empty).
  let smtSummary;
  try {
    ({ smtSummary } = await import('../../integrations/smt-info.mjs'));
  } catch {
    /* no smt reader — /tools shows the engine half only */
  }
  const server = createServer(makeHandler(state, { smtSummary }));
  server.listen(config.apiPort, config.apiHost, () => {
    console.log(`[engine-api] listening http://${config.apiHost}:${config.apiPort}`);
  });
  return server;
}
