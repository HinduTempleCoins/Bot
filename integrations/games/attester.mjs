// attester.mjs — the off-chain Voucher Attester: the missing seam of the PRANA gaming earn-loop.
//
// The whole play-to-earn / move-to-earn stack is built (PRANA ArcadeFaucet/GeominingSettlement
// contracts, the game-client voucher request shape, this repo's arcade.mjs anti-cheat + wearable.mjs
// step layer). The ONE missing piece was a server that VERIFIES a run/steps and SIGNS the EIP-712
// voucher the faucet redeems. This is that server. One attester unlocks EVERY earn surface, because
// arcade, move-to-earn and geomining all redeem the SAME ArcadeFaucet voucher shape.
//
// Flow:  game client POSTs { gameId, player, score, runHash } at game-over
//   → attester re-validates the run (arcade.plausible), maps score→reward (arcade.payoutFor),
//   → computes scoreRef, builds + signs the EIP-712 Voucher, returns the signed claim tuple
//   → player (or a relayer) calls ArcadeFaucet.claim(player, amount, scoreRef, deadline, nonce, sig).
//
// On-chain contract this mirrors EXACTLY (PRANA contracts/contracts/ArcadeFaucet.sol):
//   domain  : EIP712("ArcadeFaucet","1"), chainId=<prana 108369>, verifyingContract=<faucet>
//   type    : Voucher(address player,uint256 amount,bytes32 scoreRef,uint256 deadline,uint256 nonce)
//   claim   : claim(player, amount, scoreRef, deadline, nonce, signature)
//
// KEY CUSTODY: the attester signs VOUCHERS ONLY — it never moves value (the faucet does, from an
// externally-funded pool with on-chain nonce/cooldown/daily-cap backstops). The attester private key
// comes from env ATTESTER_KEY at call time and is NEVER logged or written. EIP-712 is implemented on
// @noble (audited keccak + secp256k1) — no ethers, house-light. Pure + deterministic → fully offline
// testable. handler(req,res) exported; CLI starts the daemon.
//
//   ATTESTER_KEY=0x… ARCADE_FAUCET_ADDRESS=0x… PRANA_CHAIN_ID=108369 PORT=8141 node integrations/games/attester.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes, bytesToHex, utf8ToBytes, concatBytes } from '@noble/hashes/utils';

import { plausible, payoutFor } from './arcade.mjs';
import { stepReward } from '../soapbox/wearable.mjs';

// ── config (env at call time; key never logged) ───────────────────────────────────────────────────
const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const chainId = () => BigInt(env('PRANA_CHAIN_ID', '108369'));
export const faucetAddress = () => env('ARCADE_FAUCET_ADDRESS', '');
const attesterKey = () => env('ATTESTER_KEY', '');
const decimals = () => BigInt(env('REWARD_DECIMALS', '18'));
const TTL_SEC = () => Number(env('VOUCHER_TTL_SEC', '3600'));

// ── primitives ──────────────────────────────────────────────────────────────────────────────────
const strip0x = (s) => String(s || '').replace(/^0x/i, '');
const keccak = (bytes) => keccak_256(bytes);
const keccakHex = (bytes) => '0x' + bytesToHex(keccak(bytes));
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));

function b32FromHex(hex) {
  const b = hexToBytes(strip0x(hex).padStart(64, '0').slice(-64));
  return b;
}
function b32FromBig(n) {
  let h = BigInt(n).toString(16);
  if (h.length > 64) throw new Error('uint256 overflow');
  return hexToBytes(h.padStart(64, '0'));
}
function addrWord(addr) {
  if (!isAddr(addr)) throw new Error(`bad address: ${addr}`);
  return hexToBytes(strip0x(addr).toLowerCase().padStart(64, '0'));
}

const DOMAIN_TYPEHASH = keccak(utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const VOUCHER_TYPEHASH = keccak(utf8ToBytes('Voucher(address player,uint256 amount,bytes32 scoreRef,uint256 deadline,uint256 nonce)'));

function domainSeparator(name, version, cid, verifyingContract) {
  return keccak(concatBytes(
    DOMAIN_TYPEHASH,
    keccak(utf8ToBytes(name)),
    keccak(utf8ToBytes(version)),
    b32FromBig(cid),
    addrWord(verifyingContract),
  ));
}
function structHash({ player, amount, scoreRef, deadline, nonce }) {
  return keccak(concatBytes(
    VOUCHER_TYPEHASH,
    addrWord(player),
    b32FromBig(amount),
    b32FromHex(scoreRef),
    b32FromBig(deadline),
    b32FromBig(nonce),
  ));
}

/** The exact EIP-712 digest ArcadeFaucet.hashVoucher / a signature must cover. Returns 0x-hex (32 bytes). */
export function voucherDigest(voucher, faucet, cid = chainId()) {
  const sep = domainSeparator('ArcadeFaucet', '1', cid, faucet);
  const sh = structHash(voucher);
  return '0x' + bytesToHex(keccak(concatBytes(Uint8Array.of(0x19, 0x01), sep, sh)));
}

/** Address (0x, lowercase) of a private key — to confirm it matches the on-chain ATTESTER_ROLE. */
export function attesterAddressOf(key = attesterKey()) {
  if (!key) return '';
  const pub = secp256k1.getPublicKey(hexToBytes(strip0x(key)), false); // 65-byte uncompressed
  return '0x' + bytesToHex(keccak(pub.slice(1)).slice(-20));
}

/** Sign a 32-byte digest with the attester key → 65-byte Ethereum signature (r||s||v). */
export function signDigest(digestHex, key = attesterKey()) {
  const sig = secp256k1.sign(hexToBytes(strip0x(digestHex)), hexToBytes(strip0x(key))); // lowS, no rehash
  const r = b32FromBig(sig.r);
  const s = b32FromBig(sig.s);
  const v = Uint8Array.of(sig.recovery + 27);
  return '0x' + bytesToHex(concatBytes(r, s, v));
}

/** Recover the signer address from a digest + signature (verify a voucher before submitting). */
export function recoverSigner(digestHex, signatureHex) {
  const sigBytes = hexToBytes(strip0x(signatureHex));
  if (sigBytes.length !== 65) return '';
  const v = sigBytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  const compact = sigBytes.slice(0, 64);
  try {
    const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery);
    const pub = sig.recoverPublicKey(hexToBytes(strip0x(digestHex))).toRawBytes(false);
    return '0x' + bytesToHex(keccak(pub.slice(1)).slice(-20));
  } catch { return ''; }
}

/** Opaque bytes32 scoreRef bound to the run (the faucet logs it; the signature covers it). */
export function scoreRefFor({ gameId = '', player = '', score = 0, runHash = '' }) {
  return keccakHex(utf8ToBytes(`${gameId}|${String(player).toLowerCase()}|${score}|${runHash}`));
}

// ── the attestation core ──────────────────────────────────────────────────────────────────────────
// Build (and, if a key is present, sign) a voucher for a validated reward amount. Never throws.
function buildAndSign({ player, payout, scoreRef }, opts = {}) {
  const faucet = opts.faucet || faucetAddress();
  const cid = opts.chainId != null ? BigInt(opts.chainId) : chainId();
  // reward units are whole tokens; floor defensively (e.g. step rewards can be fractional) then scale.
  const whole = Math.max(0, Math.floor(Number(payout) || 0));
  const amount = BigInt(whole) * (10n ** (opts.decimals != null ? BigInt(opts.decimals) : decimals()));
  const nowSec = Math.floor((opts.now != null ? opts.now : Date.now()) / 1000);
  const deadline = BigInt(nowSec + (opts.ttlSec != null ? opts.ttlSec : TTL_SEC()));
  // unique single-use nonce (uint256). Deterministic if opts.nonce given (tests).
  const rand = opts.rand != null ? opts.rand : Math.random();
  const nonce = opts.nonce != null ? BigInt(opts.nonce) : (BigInt(nowSec) * 1000000n + BigInt(Math.floor(rand * 1000000)));
  const voucher = { player: String(player).toLowerCase(), amount, scoreRef, deadline, nonce };

  const base = { ok: true, payout, voucher: serialize(voucher), scoreRef };
  if (!isAddr(faucet)) return { ...base, signed: false, reason: 'no faucet address configured (set ARCADE_FAUCET_ADDRESS)' };
  const digest = voucherDigest(voucher, faucet, cid);
  const key = opts.key || attesterKey();
  if (!key) return { ...base, signed: false, reason: 'no attester key (set ATTESTER_KEY)', digest, faucet, chainId: cid.toString() };
  const signature = signDigest(digest, key);
  return {
    ...base, signed: true, faucet, chainId: cid.toString(), digest, signature,
    attester: attesterAddressOf(key),
    // exactly the tuple ArcadeFaucet.claim(player, amount, scoreRef, deadline, nonce, signature) expects
    claimArgs: [voucher.player, amount.toString(), scoreRef, deadline.toString(), nonce.toString(), signature],
  };
}
const serialize = (v) => ({ player: v.player, amount: v.amount.toString(), scoreRef: v.scoreRef, deadline: v.deadline.toString(), nonce: v.nonce.toString() });

/**
 * Attest a game run → a signed faucet voucher. Re-validates the run (anti-cheat) and maps score→reward.
 * @param {{gameId,player,score,runHash,events,elapsedMs}} run
 * @param {object} [opts]  { key, faucet, chainId, now, nonce, ttlSec, decimals, rand }
 */
export function attestArcadeRun(run = {}, opts = {}) {
  const { gameId = '', player, score, runHash = '', events, elapsedMs } = run;
  if (!isAddr(player)) return { ok: false, reason: 'player must be a 0x address' };
  const verdict = plausible({ score, events, elapsedMs });
  if (!verdict.ok) return { ok: false, reason: `run rejected: ${verdict.reason}` };
  const payout = payoutFor(score);
  if (!payout || payout <= 0) return { ok: false, reason: 'score below the reward threshold', payout: 0 };
  return buildAndSign({ player, payout, scoreRef: scoreRefFor({ gameId, player, score, runHash }) }, opts);
}

/**
 * Attest a move-to-earn step submission → a signed faucet voucher (same voucher shape as arcade).
 * @param {{player,steps,date}} sub
 */
export function attestSteps(sub = {}, opts = {}) {
  const { player, steps, date = '' } = sub;
  if (!isAddr(player)) return { ok: false, reason: 'player must be a 0x address' };
  const n = Number(steps);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'steps must be a positive number' };
  const payout = Math.floor(stepReward(n));
  if (!payout || payout <= 0) return { ok: false, reason: 'steps below the reward threshold (need a whole reward unit)', payout: 0 };
  return buildAndSign({ player, payout, scoreRef: scoreRefFor({ gameId: 'move-to-earn', player, score: n, runHash: date }) }, opts);
}

// ── HTTP daemon ─────────────────────────────────────────────────────────────────────────────────
function readBody(req, max = 100_000) {
  return new Promise((resolve) => {
    let data = ''; let over = false;
    req.on('data', (c) => { data += c; if (data.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : data));
    req.on('error', () => resolve(null));
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://attester.local');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') {
      const hasKey = !!attesterKey();
      return json(res, 200, { ok: true, hasKey, attester: hasKey ? attesterAddressOf() : null, faucet: faucetAddress() || null, chainId: chainId().toString() });
    }
    if (path === '/attester') {
      return json(res, 200, { attester: attesterAddressOf() || null, faucet: faucetAddress() || null, chainId: chainId().toString() });
    }
    if ((path === '/attest/arcade' || path === '/attest/steps') && method === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
      const out = path === '/attest/arcade' ? attestArcadeRun(body) : attestSteps(body);
      return json(res, out.ok ? 200 : 422, out);
    }
    return json(res, 404, { ok: false, reason: 'not found' });
  } catch (e) {
    return json(res, 500, { ok: false, reason: 'error' });
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +(env('PORT', '8141'));
  const HOST = env('HOST', '127.0.0.1');
  createServer(handler).listen(PORT, HOST, () => {
    const a = attesterAddressOf();
    console.log(`PRANA voucher attester on http://${HOST}:${PORT}`);
    console.log(`  attester: ${a || '(no ATTESTER_KEY set)'} · faucet: ${faucetAddress() || '(no ARCADE_FAUCET_ADDRESS)'} · chainId ${chainId()}`);
  });
}
