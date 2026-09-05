// prana-arcade.mjs — the SoapBox Arcade PLUG. Connects any MELEK surface (a Pentecaust game channel, the Move
// app, an arcade game, the casino, the farm) to PRANA's on-chain Season/Seed platform:
//   • ArcadeLeaderboard — time-derived seasons + EIP-712 attester-signed scores + per-season prize pools.
//   • SeasonPass        — battle-pass XP (a GRANTER_ROLE call, not a signed voucher).
//
// THE TRUST MODEL: a registered game's scores are only accepted on-chain if the game's ATTESTER signed the
// EIP-712 `Score` voucher. The BOT is that attester — but it must sign ONLY a score it has VALIDATED
// (compose upstream with integrations/games/arcade.mjs `plausible()`/`submitScore`). This module never
// validates and never trusts a client; it just turns an already-trusted score into a voucher the contract
// accepts, and reads the boards back.
//
// KEY CUSTODY (BRIEF.md §7): this module SIGNS NOTHING itself and hardcodes no key. The signer is INJECTED
// (an ethers Wallet at the edge from a server-env/vault attester key, or a MELEK-Signer call). Reads go
// through an injected `call`/provider. Tests run fully offline with a throwaway wallet. Soft-fail-never-throw.
//
//   import { gameId, currentSeason, buildVoucher, scoreDigest, signScore, recoverAttester,
//            recordScore, addXpCall, __setReader } from './prana-arcade.mjs'

import { ethers } from 'ethers';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const CHAIN_ID = () => Number(env('PRANA_CHAIN_ID', '712217')) || 712217;   // MAINNET; alpha is 108369
export const ARCADE_ADDRESS = () => String(env('ARCADE_LEADERBOARD_ADDRESS', '') || '').trim();
export const SEASONPASS_ADDRESS = () => String(env('SEASON_PASS_ADDRESS', '') || '').trim();

// EIP-712 surface — MUST match ArcadeLeaderboard's `EIP712("ArcadeLeaderboard","1")` + SCORE_TYPEHASH so
// the digest here equals the contract's hashScore(...) and postScore accepts our signature.
const DOMAIN_NAME = 'ArcadeLeaderboard';
const DOMAIN_VERSION = '1';
const SCORE_TYPES = {
  Score: [
    { name: 'player', type: 'address' },
    { name: 'gameId', type: 'bytes32' },
    { name: 'season', type: 'uint256' },
    { name: 'score', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
function domain(contract = ARCADE_ADDRESS(), chainId = CHAIN_ID()) {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: contract };
}

const isBytes32 = (s) => /^0x[0-9a-fA-F]{64}$/.test(String(s || ''));

/** Stable bytes32 game id any surface registers under: keccak256(name). A 0x..32-byte value passes through. */
export function gameId(name) {
  const s = String(name == null ? '' : name);
  return isBytes32(s) ? s.toLowerCase() : ethers.keccak256(ethers.toUtf8Bytes(s));
}

/** Season index — EXACTLY the contract's `block.timestamp / seasonLength` (no keeper). 0 if misconfigured. */
export function currentSeason(seasonLength, nowSec = Math.floor(Date.now() / 1000)) {
  const L = Number(seasonLength);
  if (!Number.isFinite(L) || L <= 0) return 0;
  return Math.floor(Number(nowSec) / L);
}

/** Normalize a voucher to the exact field types the contract hashes. Throws only on a bad address. */
export function buildVoucher({ player, game, gameId: gid, season, score, nonce, deadline } = {}) {
  return {
    player: ethers.getAddress(String(player)),
    gameId: gameId(gid != null ? gid : game),
    season: BigInt(season ?? 0),
    score: BigInt(score ?? 0),
    nonce: BigInt(nonce ?? 0),
    deadline: BigInt(deadline ?? 0),
  };
}
const norm = (v) => (v && v.player && typeof v.gameId === 'string' && typeof v.season === 'bigint' ? v : buildVoucher(v));

/** The EIP-712 digest — equals the contract's hashScore(...). Pure, offline. */
export function scoreDigest(voucher, { contract = ARCADE_ADDRESS(), chainId = CHAIN_ID() } = {}) {
  return ethers.TypedDataEncoder.hash(domain(contract, chainId), SCORE_TYPES, norm(voucher));
}

/**
 * Sign a (validated) score voucher with the INJECTED attester signer (edge: an ethers Wallet from the
 * env/vault attester key, or a MELEK-Signer adapter exposing signTypedData). Returns { voucher, signature }
 * ready for ArcadeLeaderboard.postScore. Never signs here without a signer; never holds a key.
 */
export async function signScore(voucher, signer, { contract = ARCADE_ADDRESS(), chainId = CHAIN_ID() } = {}) {
  const v = norm(voucher);
  if (!signer || typeof signer.signTypedData !== 'function') return { ok: false, reason: 'no-signer' };
  try {
    const signature = await signer.signTypedData(domain(contract, chainId), SCORE_TYPES, v);
    return { ok: true, voucher: v, signature };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

/** Recover the attester address that signed a voucher — verify a voucher offline. */
export function recoverAttester(voucher, signature, { contract = ARCADE_ADDRESS(), chainId = CHAIN_ID() } = {}) {
  try { return ethers.verifyTypedData(domain(contract, chainId), SCORE_TYPES, norm(voucher), signature); }
  catch { return null; }
}

/** A unique single-use nonce for a score (namespaced per game on-chain; uniqueness is all that's needed). */
export function freshNonce() { return BigInt(ethers.hexlify(ethers.randomBytes(16))); }

/**
 * recordScore — the one call any surface makes. Compose: caller has ALREADY validated the score (e.g. via
 * arcade.mjs). Builds the voucher, signs it with the injected attester `signer`, and hands it to the
 * injected `post(call)` (the edge ethers Contract.postScore tx). Returns a safe shape; never throws.
 * @param {{game, player, score, season, seasonLength?, nonce?, deadline?, ttlSec?}} s
 * @param {{signer, post?, contract?, chainId?, now?}} io
 */
export async function recordScore(s = {}, io = {}) {
  const now = Number(io.now || Math.floor(Date.now() / 1000));
  const season = s.season != null ? s.season : currentSeason(s.seasonLength, now);
  const deadline = s.deadline != null ? s.deadline : now + Number(s.ttlSec || 600);
  const nonce = s.nonce != null ? s.nonce : freshNonce();
  let voucher;
  try { voucher = buildVoucher({ player: s.player, game: s.game, season, score: s.score, nonce, deadline }); }
  catch (e) { return { ok: false, reason: `bad-voucher: ${e.message}` }; }

  const signed = await signScore(voucher, io.signer, { contract: io.contract, chainId: io.chainId });
  if (!signed.ok) return signed;

  // postScore(player, gameId, season, score, nonce, deadline, signature) — the edge submits this.
  const call = { fn: 'postScore', args: [voucher.player, voucher.gameId, voucher.season, voucher.score, voucher.nonce, voucher.deadline, signed.signature] };
  if (typeof io.post !== 'function') return { ok: true, posted: false, voucher, signature: signed.signature, call };
  try { const result = await io.post(call); return { ok: true, posted: true, voucher, signature: signed.signature, result }; }
  catch (e) { return { ok: false, reason: `post-failed: ${String(e && e.message || e)}`, voucher, signature: signed.signature, call }; }
}

/** SeasonPass.addXp is a GRANTER_ROLE call (not a signed voucher) — return the call the edge submits. */
export function addXpCall(player, amount) {
  return { contract: SEASONPASS_ADDRESS(), fn: 'addXp', args: [ethers.getAddress(String(player)), BigInt(amount)] };
}

// ── reads (injected; edge wires an ethers Contract / the prana-rpc-gateway) ──────────────────────────
let _reader = null;
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }
async function read(fn, args) {
  if (!_reader) return null;
  try { return await _reader(fn, args); } catch { return null; }
}
/** currentSeason / getBoard / getPool on-chain (via the injected reader). Soft-null on no reader/error. */
export const readCurrentSeason = (game) => read('currentSeason', [gameId(game)]);
export const readBoard = (game, season) => read('getBoard', [gameId(game), BigInt(season)]);
export const readPool = (game, season) => read('getPool', [gameId(game), BigInt(season)]);

// ── CLI: print the EIP-712 surface + a sample digest (no key, no network) ────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('prana-arcade.mjs')) {
  const v = buildVoucher({ player: '0x' + '11'.repeat(20), game: 'pentecaust-arena', season: currentSeason(86400), score: 1234, nonce: 1, deadline: Math.floor(Date.now() / 1000) + 600 });
  console.log(JSON.stringify({
    chainId: CHAIN_ID(), arcade: ARCADE_ADDRESS() || '(set ARCADE_LEADERBOARD_ADDRESS)',
    gameId: v.gameId, season: v.season.toString(), digest: scoreDigest(v),
  }, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
}
