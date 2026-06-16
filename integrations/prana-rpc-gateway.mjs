// prana-rpc-gateway.mjs — a safe, public, method-whitelisted JSON-RPC gateway for the PRANA node.
//
// The PRANA geth node binds 127.0.0.1:8545 with --http.api eth,net,web3,personal,txpool,miner,debug.
// Browser wallets (Akasha) + the DEX (KulaSwap) need a PUBLIC endpoint, but exposing the raw RPC would
// publish personal_* (account unlock/sign), miner_*, debug_*, txpool_* to the internet. This gateway
// sits in front and forwards ONLY the read/broadcast namespaces a wallet/DEX needs:
//   eth_*  (incl. eth_sendRawTransaction — broadcasting a client-signed tx is safe), net_*, web3_*
// Everything else is rejected with a JSON-RPC "method not allowed" error. Admin namespaces stay
// localhost-only on the node. Caddy terminates TLS in front of this (rpc.prana.melek.salon).
//
// House style: handler(req,res) exported for tests, soft-fail-never-throw, injectable fetch (__setFetch),
// CLI guarded by import.meta. Env: PRANA_GETH_URL (default http://127.0.0.1:8545), PORT (default 8547).

import { fileURLToPath } from 'node:url';

const GETH_URL = process.env.PRANA_GETH_URL || 'http://127.0.0.1:8545';
const PORT = +(process.env.PORT || process.env.PRANA_GATEWAY_PORT || 8547);

// Only these JSON-RPC namespaces reach the node. eth_sendRawTransaction is an eth_ method, so
// broadcasting a client-signed transaction works; signing itself never happens on the node.
const ALLOW = /^(eth|net|web3)_[a-zA-Z0-9_]+$/;

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** True iff `m` is a method we forward to the node (eth_/net_/web3_ only). */
export function isAllowedMethod(m) { return typeof m === 'string' && ALLOW.test(m); }

const rpcErr = (id, message, code = -32601) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

async function forward(payload) {
  // payload is the allowed-only request (single object or sub-batch array). Host is localhost so
  // the node's default vhosts check passes. Soft-fail to a JSON-RPC network error.
  try {
    const r = await _fetch(GETH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost' },
      body: JSON.stringify(payload),
    });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Filter a parsed JSON-RPC body (single object or batch array) down to allowed calls, forward those
 * to the node, and merge node results with synthesized "not allowed" errors — preserving id order.
 * @returns the response value to send back (object for single, array for batch).
 */
export async function handleRpc(body) {
  const isBatch = Array.isArray(body);
  const calls = isBatch ? body : [body];
  const results = new Array(calls.length);
  const fwd = [];
  const fwdIdx = [];
  calls.forEach((c, i) => {
    if (c && isAllowedMethod(c.method)) { fwdIdx.push(i); fwd.push(c); }
    else results[i] = rpcErr(c && c.id, `method not allowed on public RPC: ${(c && c.method) || 'unknown'}`);
  });
  if (fwd.length) {
    const upstream = await forward(isBatch ? fwd : fwd[0]);
    const ups = upstream == null ? null : (Array.isArray(upstream) ? upstream : [upstream]);
    fwdIdx.forEach((origIdx, k) => {
      results[origIdx] = (ups && ups[k] != null) ? ups[k] : rpcErr(fwd[k] && fwd[k].id, 'node unreachable', -32603);
    });
  }
  return isBatch ? results : results[0];
}

export async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', ...CORS });
      return res.end(JSON.stringify(rpcErr(null, 'POST only', -32600)));
    }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) break; } // cap 1MB
    let body;
    try { body = JSON.parse(raw || '{}'); } catch {
      res.writeHead(200, { 'content-type': 'application/json', ...CORS });
      return res.end(JSON.stringify(rpcErr(null, 'parse error', -32700)));
    }
    const out = await handleRpc(body);
    res.writeHead(200, { 'content-type': 'application/json', ...CORS });
    return res.end(JSON.stringify(out));
  } catch {
    // never throw to the socket
    res.writeHead(200, { 'content-type': 'application/json', ...CORS });
    return res.end(JSON.stringify(rpcErr(null, 'gateway error', -32603)));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const http = await import('node:http');
  http.createServer(handler).listen(PORT, '127.0.0.1', () => process.stdout.write(`prana-rpc-gateway on 127.0.0.1:${PORT} -> ${GETH_URL}\n`));
}
