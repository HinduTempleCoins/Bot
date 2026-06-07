// faucet-testnet.mjs — TESTNET-ONLY account-creation faucet for the MELEK testnet condenser.
//
// PURPOSE
//   The alpha.melek.salon signup page generates the user's keys CLIENT-SIDE in the browser
//   (hard rule — the server never sees user PRIVATE keys). It then POSTs ONLY the new account
//   name + the four PUBLIC keys to this faucet. This faucet builds an `account_create` op and
//   signs it with the testnet creator account's active key, then broadcasts it to the testnet.
//
// THIS IS A TESTNET TOOL. It signs with a THROWAWAY TESTNET key only. It must NEVER be pointed
//   at mainnet and must NEVER be given a mainnet WIF. The well-known testnet creator key lives on
//   the testnet host (config.ini) — see FAUCET_WIF / FAUCET_WIF_FILE below. Everything it touches
//   (TESTS/TBD/VESTS, chain id 18dcf0...) is testnet.
//
// CUSTODY
//   - Accepts ONLY public keys from the client. Rejects anything private-key-shaped (reuses the
//     guard from account-create.mjs).
//   - The creator key is read from env (FAUCET_WIF) or a file (FAUCET_WIF_FILE) at startup; it is
//     never logged, never returned in a response.
//
// CONFIG (env)
//   FAUCET_PORT        listen port (default 7790, bound to 127.0.0.1)
//   FAUCET_RPC         testnet RPC (default http://127.0.0.1:8090 — local node on the testnet host)
//   FAUCET_CHAIN_ID    testnet chain id (default the live MELEK testnet id)
//   FAUCET_PREFIX      address prefix (default TST)
//   FAUCET_CREATOR     creator account (default initminer)
//   FAUCET_WIF         creator active WIF (testnet). OR:
//   FAUCET_WIF_FILE    path to a file whose first line is the creator active WIF (testnet).
//   FAUCET_FEE         account_creation_fee to pay (default "0.001 TESTS")
//   FAUCET_DELEGATION  initial VESTS delegation (default "0.000000 VESTS")
//
// RUN
//   node signup/faucet-testnet.mjs
//
// ENDPOINTS
//   GET  /faucet/health   -> { ok, creator, chain_id_prefix, testnet:true }   (no secrets)
//   POST /faucet/create   { name, ownerPub, activePub, postingPub, memoPub } -> { ok, id?, reason? }

import http from 'node:http';
import fs from 'node:fs';
import { Client, PrivateKey } from '@hiveio/dhive';
import { Limiter, clientIp } from '../integrations/rate-limit.mjs';

// ── inlined key/name validators (mirrors signup/account-create.mjs; kept self-contained so the
//    faucet has no cross-module import chain when deployed standalone on the testnet host) ──────
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function isBase58(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  for (const ch of s) if (!BASE58.includes(ch)) return false;
  return true;
}
function rejectIfPrivateKey(key) {
  if (typeof key !== 'string' || key.length === 0) throw new Error('key must be a non-empty string');
  const k = key.trim();
  if (/^5[1-9A-HJ-NP-Za-km-z]{47,52}$/.test(k) && isBase58(k)) throw new Error('refusing WIF — public keys only');
  if (/^P5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(k)) throw new Error('refusing WIF — public keys only');
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(k)) throw new Error('refusing raw private key — public keys only');
  return k;
}
function looksLikePublicKey(key) {
  if (typeof key !== 'string') return false;
  const m = /^([A-Z]{2,4})([1-9A-HJ-NP-Za-km-z]{40,60})$/.exec(key.trim());
  return !!m && isBase58(m[2]);
}
const SEGMENT_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
function validAccountName(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 3 || name.length > 16) return false;
  for (const seg of name.split('.')) {
    if (seg.length < 3 || seg.length > 16) return false;
    if (!SEGMENT_RE.test(seg)) return false;
    if (seg.includes('--')) return false;
  }
  return true;
}

const PORT = parseInt(process.env.FAUCET_PORT || '7790', 10);
const RPC = process.env.FAUCET_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = (process.env.FAUCET_CHAIN_ID ||
  '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e').trim();
const PREFIX = (process.env.FAUCET_PREFIX || 'TST').trim();
const CREATOR = (process.env.FAUCET_CREATOR || 'initminer').trim();
const FEE = process.env.FAUCET_FEE || '0.001 TESTS';
const DELEGATION = process.env.FAUCET_DELEGATION || '0.000000 VESTS';

// TESTNET SAFETY: refuse to run against anything that is not the known testnet symbol/prefix.
if (PREFIX !== 'TST' || !/TESTS$/.test(FEE)) {
  console.error('faucet refuses to start: prefix must be TST and fee must be in TESTS (testnet only).');
  process.exit(2);
}

function loadCreatorWif() {
  if (process.env.FAUCET_WIF && process.env.FAUCET_WIF.trim()) return process.env.FAUCET_WIF.trim();
  if (process.env.FAUCET_WIF_FILE) {
    const raw = fs.readFileSync(process.env.FAUCET_WIF_FILE, 'utf8');
    const line = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
    if (line) return line;
  }
  throw new Error('no creator WIF: set FAUCET_WIF or FAUCET_WIF_FILE (testnet key only)');
}

const CREATOR_WIF = loadCreatorWif();
const creatorKey = PrivateKey.fromString(CREATOR_WIF);

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 15000 });

// ── abuse rate limiter ──────────────────────────────────────────────────────────────────────────
// The faucet mints FUNDED accounts — the highest-abuse surface (the live bounded spam-test minted
// 5/5 funded accounts from one client with zero throttle). Cap per-IP and per-fingerprint over a
// sliding window. Defaults (env-tunable via RL_* in rate-limit.mjs) are deliberately generous so a
// genuine person can retry, but a script can't mint dozens. Soft-fails OPEN if state is unreadable.
//   FAUCET_RL_IP_MAX        accounts per IP per window         (default 5)
//   FAUCET_RL_FP_MAX        accounts per fingerprint per window (default 2)
//   FAUCET_RL_WINDOW_SEC    window length, seconds              (default 86400 = 24 h)
const faucetLimiter = new Limiter({
  scope: 'faucet',
  ipMax: parseInt(process.env.FAUCET_RL_IP_MAX || '5', 10),
  fpMax: parseInt(process.env.FAUCET_RL_FP_MAX || '2', 10),
  windowSec: parseInt(process.env.FAUCET_RL_WINDOW_SEC || '86400', 10),
});

function auth(pub) {
  return { weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] };
}

function validatePubs(input) {
  const { ownerPub, activePub, postingPub, memoPub } = input;
  const keys = { ownerPub, activePub, postingPub, memoPub };
  for (const [label, key] of Object.entries(keys)) {
    try { rejectIfPrivateKey(key); }
    catch { return { ok: false, reason: `private-key-rejected:${label}` }; }
    if (!looksLikePublicKey(key)) return { ok: false, reason: `invalid-public-key:${label}` };
    if (!key.startsWith(PREFIX)) return { ok: false, reason: `wrong-prefix:${label}` };
  }
  return { ok: true };
}

async function createAccount(input) {
  if (!validAccountName(input.name)) return { ok: false, reason: 'invalid-account-name' };
  const pv = validatePubs(input);
  if (!pv.ok) return pv;

  const op = ['account_create', {
    fee: FEE,
    creator: CREATOR,
    new_account_name: input.name,
    owner: auth(input.ownerPub),
    active: auth(input.activePub),
    posting: auth(input.postingPub),
    memo_key: input.memoPub,
    json_metadata: '',
  }];

  // If the chain rejects bare account_create (some forks require _with_delegation), retry with it.
  try {
    const r = await client.broadcast.sendOperations([op], creatorKey);
    return { ok: true, id: r.id || r.trx_id || null };
  } catch (e1) {
    const withDel = ['account_create_with_delegation', {
      fee: FEE,
      delegation: DELEGATION,
      creator: CREATOR,
      new_account_name: input.name,
      owner: auth(input.ownerPub),
      active: auth(input.activePub),
      posting: auth(input.postingPub),
      memo_key: input.memoPub,
      json_metadata: '',
      extensions: [],
    }];
    try {
      const r = await client.broadcast.sendOperations([withDel], creatorKey);
      return { ok: true, id: r.id || r.trx_id || null };
    } catch (e2) {
      const msg = (e2 && e2.message) || (e1 && e1.message) || 'broadcast-failed';
      return { ok: false, reason: `broadcast-failed:${String(msg).slice(0, 300)}` };
    }
  }
}

function send(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url.startsWith('/faucet/health')) {
    return send(res, 200, {
      ok: true, testnet: true, creator: CREATOR,
      chain_id_prefix: CHAIN_ID.slice(0, 6), address_prefix: PREFIX, rpc: RPC,
    });
  }
  if (req.method === 'POST' && req.url.startsWith('/faucet/create')) {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(buf || '{}'); }
      catch { return send(res, 400, { ok: false, reason: 'bad-json' }); }
      // Abuse cap BEFORE the costly broadcast. Fingerprint: a client-supplied device hash header if
      // present, else the requested account name (weak, but still bounds naive scripting). Per-IP is
      // the real backstop. Limiter never throws and soft-fails open.
      const fp = (req.headers && (req.headers['x-fingerprint'] || req.headers['x-device-id'])) ||
        (input && input.name) || 'unknown';
      const rl = faucetLimiter.check({ ip: clientIp(req), fingerprint: String(fp) });
      if (!rl.allowed) {
        return send(res, 429, { ok: false, reason: 'rate-limited', detail: rl.reason, retryAfter: rl.retryAfter });
      }
      try {
        const out = await createAccount(input);
        return send(res, out.ok ? 200 : 400, out);
      } catch (e) {
        return send(res, 500, { ok: false, reason: `error:${(e && e.message) || 'unknown'}` });
      }
    });
    return;
  }
  return send(res, 404, { ok: false, reason: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`faucet-testnet listening on 127.0.0.1:${PORT} creator=${CREATOR} prefix=${PREFIX} rpc=${RPC}`);
});
