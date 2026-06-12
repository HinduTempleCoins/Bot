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
//   GET  /faucet/health   -> { ok, testnet:true, creator, chain_id_prefix, address_prefix }  (no secrets, no RPC URL)
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
// Exported so signup/account-name-parity.test.mjs can assert this inlined copy stays in lockstep
// with the account-create.mjs / server.mjs implementations. The export does not change the faucet's
// standalone behaviour (no new import chain).
export function validAccountName(name) {
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
// A brand-new Graphene account has ZERO Resource Credits and literally cannot post/comment/
// transfer until it owns staked POWER (vesting). Operator model (2026-06-11): Hathor GIVES the
// newcomer a little MELEK as posting-power — a real gift the account OWNS (transfer_to_vesting /
// "power up" into their account), NOT a delegation loan retained by Hathor. So at creation we
// power a small amount up into the new account; they own the stake and therefore their own RC.
// Amount is a liquid TESTS figure that gets powered up; set FAUCET_POWER_GIFT="0.000 TESTS" only
// if you deliberately want mute accounts. (Back-compat: legacy FAUCET_DELEGATION is still read.)
const POWER_GIFT = (process.env.FAUCET_POWER_GIFT || process.env.FAUCET_DELEGATION_TESTS || '3.000 TESTS').trim();
const wantsPower = !/^0\.0+\s+TESTS$/.test(POWER_GIFT) && /TESTS$/.test(POWER_GIFT);

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

// The creator key + chain client are constructed lazily (only when the server actually starts) so
// the module can be imported in offline tests WITHOUT a WIF in the env. The CLI guard at the bottom
// builds them via initChain() before listening.
let creatorKey = null;
let client = null;
function initChain() {
  const CREATOR_WIF = loadCreatorWif();
  creatorKey = PrivateKey.fromString(CREATOR_WIF);
  client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 15000 });
}

// Test seam: inject a fake chain client (and optionally a fake key) so createAccount's op shape is
// offline-verifiable without a real RPC or a creator WIF. The fake client only needs a
// broadcast.sendOperations(ops, key) method that records its calls. NEVER used by the CLI path.
export function __setClient(fakeClient, fakeKey = null) {
  client = fakeClient;
  if (fakeKey !== null) creatorKey = fakeKey;
}

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

// The chain validates `account_create.fee == witness_schedule.median_props.account_creation_fee`
// EXACTLY (not ">="). That median moves with witness votes and resets to the genesis default after
// a chain re-genesis (seen 2026-06-12: it dropped to "0.000 TESTS", so a hardcoded 0.001 made every
// signup fail with "Must pay the exact account creation fee"). So read the live value and pay it
// exactly; fall back to FEE (env/default) only if the read fails. Cached briefly to avoid an RPC per
// signup. Soft-fail-never-throw: any error → fall back to FEE.
let _feeCache = null;
let _feeCacheAt = 0;
async function exactCreationFee() {
  const now = Date.now();
  if (_feeCache && (now - _feeCacheAt) < 60000) return _feeCache;
  try {
    const sched = await client.call('condenser_api', 'get_witness_schedule', []);
    const fee = sched && sched.median_props && sched.median_props.account_creation_fee;
    if (fee && /TESTS$/.test(String(fee).trim())) {
      _feeCache = String(fee).trim();
      _feeCacheAt = now;
      return _feeCache;
    }
  } catch { /* fall through to env/default */ }
  return FEE;
}

export async function createAccount(input) {
  if (!validAccountName(input.name)) return { ok: false, reason: 'invalid-account-name' };
  const pv = validatePubs(input);
  if (!pv.ok) return pv;

  const bare = ['account_create', {
    fee: await exactCreationFee(),
    creator: CREATOR,
    new_account_name: input.name,
    owner: auth(input.ownerPub),
    active: auth(input.activePub),
    posting: auth(input.postingPub),
    memo_key: input.memoPub,
    json_metadata: '',
  }];

  // Create the account. (This Steem fork at HF23 does NOT honor account_create_with_delegation —
  // it silently yields zero delegation — so we create bare and then delegate explicitly below.)
  let createId;
  try {
    const r = await client.broadcast.sendOperations([bare], creatorKey);
    createId = r.id || r.trx_id || null;
  } catch (e) {
    return { ok: false, reason: `broadcast-failed:${String((e && e.message) || 'create').slice(0, 300)}` };
  }

  // Hathor GIVES the newcomer a little posting-power so they can post/comment/transfer from minute
  // one. A fresh account has ZERO RC; RC comes from staked POWER, so we power a small MELEK amount
  // UP into the new account (transfer_to_vesting) — the account OWNS this stake (a gift, not a loan
  // Hathor reclaims). Best-effort: the account already exists, so a power-up hiccup must not fail
  // the signup — we just report it so the caller can retry.
  let poweredUp = null, powerError = null;
  if (wantsPower) {
    try {
      await client.broadcast.sendOperations(
        [['transfer_to_vesting', { from: CREATOR, to: input.name, amount: POWER_GIFT }]],
        creatorKey,
      );
      poweredUp = POWER_GIFT;
    } catch (e) {
      powerError = String((e && e.message) || 'power-up-failed').slice(0, 200);
    }
  }
  return { ok: true, id: createId, poweredUp, powerError };
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

const MAX_BODY = 8192;

// Request handler factory. Deps are injectable so the request flow (rate-limit / oversize / broadcast
// outcome) is offline-testable without a real chain client or creator key.
//   create  — async (input) => { ok, id?, reason? }   (defaults to the live createAccount)
//   limiter — a Limiter instance                       (defaults to the module faucetLimiter)
export function makeHandler({ create = createAccount, limiter = faucetLimiter } = {}) {
  return function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && req.url.startsWith('/faucet/health')) {
      // Do NOT expose the RPC URL — internal node topology stays private (the endpoint is CORS '*').
      return send(res, 200, {
        ok: true, testnet: true, creator: CREATOR,
        chain_id_prefix: CHAIN_ID.slice(0, 6), address_prefix: PREFIX,
      });
    }
    if (req.method === 'POST' && req.url.startsWith('/faucet/create')) {
      let buf = '';
      let aborted = false;
      // Mirror signup/server.mjs: on an oversize body, flag + destroy, then answer 413 in 'end'
      // (a bare req.destroy() with no response is a TCP reset the client can't read).
      req.on('data', (c) => { buf += c; if (buf.length > MAX_BODY) { aborted = true; req.destroy(); } });
      req.on('error', () => { /* client aborted; 'end' won't fire with a body — nothing to answer */ });
      req.on('end', async () => {
        if (aborted) return send(res, 413, { ok: false, reason: 'body-too-large' });
        let input;
        try { input = JSON.parse(buf || '{}'); }
        catch { return send(res, 400, { ok: false, reason: 'bad-json' }); }
        // Abuse cap is CHECKED before the costly broadcast, but only RECORDED after a successful mint
        // (a failed broadcast — chain down, dup name, bad fee — must not burn a real user's slot).
        // Fingerprint: a client-supplied device hash header if present, else the requested account
        // name (weak, but still bounds naive scripting). Per-IP is the real backstop. Soft-fails open.
        const fp = (req.headers && (req.headers['x-fingerprint'] || req.headers['x-device-id'])) ||
          (input && input.name) || 'unknown';
        const rlKey = { ip: clientIp(req), fingerprint: String(fp) };
        const rl = limiter.check(rlKey);
        if (!rl.allowed) {
          return send(res, 429, { ok: false, reason: 'rate-limited', detail: rl.reason, retryAfter: rl.retryAfter });
        }
        try {
          const out = await create(input);
          if (out && out.ok) limiter.record(rlKey); // count ONLY a successful broadcast
          return send(res, out.ok ? 200 : 400, out);
        } catch (e) {
          // Thrown error => no successful mint => no slot consumed.
          return send(res, 500, { ok: false, reason: `error:${(e && e.message) || 'unknown'}` });
        }
      });
      return;
    }
    return send(res, 404, { ok: false, reason: 'not-found' });
  };
}

// ── CLI (guarded): build the chain client/key, then listen. ─────────────────────────────────────
if (process.argv[1] && /faucet-testnet\.mjs$/.test(process.argv[1])) {
  initChain();
  const server = http.createServer(makeHandler());
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`faucet-testnet listening on 127.0.0.1:${PORT} creator=${CREATOR} prefix=${PREFIX} rpc=${RPC}`);
  });
}
