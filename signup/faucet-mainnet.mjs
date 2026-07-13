// faucet-mainnet.mjs — MELEK MAINNET account-creation faucet.
//
// Mainnet differs from the testnet faucet in three load-bearing ways, all because MELEK is a
// no-premine chain (nobody holds liquid MELEK at first) running at hardfork 20+:
//   1. Account creation uses the RC-based claim model — `claim_account` (fee 0, paid in Resource
//      Credits, not tokens) then `create_claimed_account`. Plain `account_create` needs a liquid
//      fee the creator does not have; `account_create_with_delegation` is deprecated at HF20.
//   2. The RC gift that lets a newcomer post from minute one is a `delegate_vesting_shares` (a loan
//      of STAKE → Resource Credits), NOT `transfer_to_vesting` (which needs liquid MELEK).
//   3. dhive does not know the MELEK asset symbol or the 5-char MELEK address prefix, so we patch
//      its Asset + PublicKey before any broadcast (see patchDhive below).
//
// Keys: the browser generates the user's keys client-side and sends only the 4 PUBLIC keys. The
// creator's ACTIVE key is read from env (FAUCET_WIF) or a vault item (FAUCET_VAULT_ITEM) at startup;
// it is never written to disk and never logged. This module never sees a user private key.
//
// Env:
//   FAUCET_PORT         listen port (default 7791, bound to 127.0.0.1; Caddy proxies /faucet/*)
//   FAUCET_RPC          mainnet RPC endpoint (default is a local loopback address)
//   FAUCET_CHAIN_ID     mainnet chain id (default 907959e5…)
//   FAUCET_PREFIX       address prefix (default MELEK)
//   FAUCET_CREATOR      creator account (default hathor)
//   FAUCET_WIF          creator active WIF   OR
//   FAUCET_VAULT_ITEM   vault item holding the creator active WIF
//   FAUCET_RC_DELEGATION  VESTS to delegate to each newcomer for RC (default "0.050000 VESTS")
//   FAUCET_RL_IP_MAX / FAUCET_RL_WINDOW_SEC   simple per-IP rate limit (default 5 / 86400)
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import * as dhive from '@hiveio/dhive';

// ── teach dhive about MELEK (asset symbol + 5-char prefix) ────────────────────────────────────
function patchDhive() {
  const { Asset, PublicKey } = dhive;
  const SYMS = new Set(['MELEK', 'MBD']);
  const ofs = Asset.fromString.bind(Asset);
  Asset.fromString = (s, exp) => {
    const [amt, sym] = String(s).split(' ');
    if (SYMS.has(sym)) { const a = Number.parseFloat(amt); if (!Number.isFinite(a)) throw new Error('bad amount'); return new Asset(a, sym); }
    return ofs(s, exp);
  };
  const op = Asset.prototype.getPrecision;
  Asset.prototype.getPrecision = function () { return SYMS.has(this.symbol) ? 3 : op.call(this); };
  const ofps = PublicKey.fromString.bind(PublicKey);
  PublicKey.fromString = (str) => {
    if (typeof str === 'string' && str.startsWith('MELEK')) { const pk = ofps('STM' + str.slice(5)); pk.prefix = 'MELEK'; return pk; }
    return ofps(str);
  };
  const ofpf = PublicKey.from.bind(PublicKey);
  PublicKey.from = (v) => (typeof v === 'string' && v.startsWith('MELEK')) ? PublicKey.fromString(v) : ofpf(v);
}
patchDhive();
const { Client, PrivateKey } = dhive;

const PORT = parseInt(process.env.FAUCET_PORT || '7791', 10);
const RPC = process.env.FAUCET_RPC || 'http://127.0.0.1:18090';
const CHAIN_ID = (process.env.FAUCET_CHAIN_ID || '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b').trim();
const PREFIX = (process.env.FAUCET_PREFIX || 'MELEK').trim();
const CREATOR = (process.env.FAUCET_CREATOR || 'hathor').trim();
const RC_DELEGATION = (process.env.FAUCET_RC_DELEGATION || '0.050000 VESTS').trim();

// MAINNET SAFETY: refuse to run unless the prefix is MELEK (mirror of the testnet guard, inverted).
if (PREFIX !== 'MELEK') { console.error('faucet-mainnet refuses to start: FAUCET_PREFIX must be MELEK.'); process.exit(1); }

function loadCreatorKey() {
  // interim: while hathor is still on the publicly-derivable genesis init key, derive it from the
  // known seed at runtime (nothing secret written anywhere). Switch to FAUCET_VAULT_ITEM once hathor
  // is rotated onto its real active key.
  if (process.env.FAUCET_CREATOR_SEED) return PrivateKey.fromSeed(process.env.FAUCET_CREATOR_SEED);
  return PrivateKey.fromString(loadCreatorWif());
}
function loadCreatorWif() {
  if (process.env.FAUCET_WIF && process.env.FAUCET_WIF.trim()) return process.env.FAUCET_WIF.trim();
  if (process.env.FAUCET_VAULT_ITEM) {
    // JIT-fetch the creator ACTIVE key from the operator vault — never on disk. Same path the welcomer uses.
    const out = execFileSync('node', ['/opt/melek-bot/vault.mjs', 'get', process.env.FAUCET_VAULT_ITEM], { encoding: 'utf8' });
    const m = out.match(/5[1-9A-HJ-NP-Za-km-z]{50}/);
    if (m) return m[0];
  }
  throw new Error('no creator WIF: set FAUCET_WIF or FAUCET_VAULT_ITEM');
}

let client = null, creatorKey = null;
function boot() {
  creatorKey = loadCreatorKey();
  client = new Client([RPC], { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 15000 });
}

// ── validation ────────────────────────────────────────────────────────────────────────────────
const validName = (n) => typeof n === 'string' && /^[a-z][a-z0-9-]{2,15}$/.test(n);
const looksPublic = (k) => typeof k === 'string' && /^MELEK[1-9A-HJ-NP-Za-km-z]{40,}$/.test(k);
const looksPrivate = (k) => typeof k === 'string' && (/^5[1-9A-HJ-NP-Za-km-z]{47,52}$/.test(k) || /^P5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(k));
const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
function validatePubs(i) {
  for (const [label, key] of Object.entries({ ownerPub: i.ownerPub, activePub: i.activePub, postingPub: i.postingPub, memoPub: i.memoPub })) {
    if (looksPrivate(key)) return { ok: false, reason: `private-key-rejected:${label}` };
    if (!looksPublic(key)) return { ok: false, reason: `invalid-public-key:${label}` };
  }
  return { ok: true };
}

// ── simple per-IP rate limit (in-memory sliding window) ───────────────────────────────────────
const IP_MAX = parseInt(process.env.FAUCET_RL_IP_MAX || '5', 10);
const WINDOW = parseInt(process.env.FAUCET_RL_WINDOW_SEC || '86400', 10) * 1000;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (arr.length >= IP_MAX) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

export async function createAccount(input) {
  if (!validName(input.name)) return { ok: false, reason: 'invalid-account-name' };
  const pv = validatePubs(input); if (!pv.ok) return pv;
  const [existing] = await client.database.getAccounts([input.name]);
  if (existing) return { ok: false, reason: 'name-taken' };

  // 1) claim a creation ticket (fee 0 → paid with the creator's Resource Credits)
  try {
    await client.broadcast.sendOperations([['claim_account', { creator: CREATOR, fee: '0.000 MELEK', extensions: [] }]], creatorKey);
  } catch (e) { return { ok: false, reason: `claim-failed:${String(e && e.message).slice(0, 200)}` }; }

  // 2) create the account from the claimed ticket (free)
  let createId = null;
  try {
    const r = await client.broadcast.sendOperations([['create_claimed_account', {
      creator: CREATOR, new_account_name: input.name,
      owner: auth(input.ownerPub), active: auth(input.activePub), posting: auth(input.postingPub),
      memo_key: input.memoPub, json_metadata: '', extensions: [],
    }]], creatorKey);
    createId = r.id || r.trx_id || null;
  } catch (e) { return { ok: false, reason: `create-failed:${String(e && e.message).slice(0, 300)}` }; }

  // 3) RC gift: delegate a little STAKE so the newcomer has Resource Credits to post from minute one.
  //    No liquid MELEK required — this is delegated vesting (a loan of stake, reclaimable). Best-effort.
  let delegated = null, delegateError = null;
  try {
    await client.broadcast.sendOperations([['delegate_vesting_shares', {
      delegator: CREATOR, delegatee: input.name, vesting_shares: RC_DELEGATION,
    }]], creatorKey);
    delegated = RC_DELEGATION;
  } catch (e) { delegateError = String(e && e.message).slice(0, 200); }

  return { ok: true, id: createId, delegated, delegateError };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────
function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' });
  res.end(JSON.stringify(body));
}
export function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url.startsWith('/faucet/health'))
    return send(res, 200, { ok: true, mainnet: true, creator: CREATOR, address_prefix: PREFIX });
  if (req.method === 'POST' && req.url.startsWith('/faucet/create')) {
    // The faucet listens only on loopback behind Caddy, which APPENDS the real client IP to any
    // client-supplied X-Forwarded-For — so the trustworthy value is the LAST entry, never the first
    // (taking [0] lets a client spoof the header and rotate fake IPs to bypass the per-IP limit).
    const xff = String(req.headers['x-forwarded-for'] || '');
    const ip = (xff ? xff.split(',').pop() : req.socket.remoteAddress || '').trim();
    if (rateLimited(ip)) return send(res, 429, { ok: false, reason: 'rate-limited' });
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { ok: false, reason: 'bad-json' }); }
      try { const r = await createAccount(body); return send(res, r.ok ? 200 : 400, r); }
      catch (e) { return send(res, 500, { ok: false, reason: `error:${String(e && e.message).slice(0, 200)}` }); }
    });
    return;
  }
  return send(res, 404, { ok: false, reason: 'not-found' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  boot();
  http.createServer(handler).listen(PORT, '127.0.0.1', () => console.log(`faucet-mainnet on 127.0.0.1:${PORT} creator=${CREATOR} prefix=${PREFIX}`));
}
