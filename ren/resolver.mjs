// ren/resolver.mjs — REN naming resolver for the MELEK ecosystem.
//
// REN (Egyptian *Ren* = a being's true name) is an ENS-lite registrar deployed on PRANA
// (RENRegistrar). Names like `ryan.melek` are ERC-721, leased annually, payable in PRANA or
// KULA, and they resolve to: an address, an IPFS contenthash (a site), and arbitrary text records.
//
// This module is the READ + tx-build path the ecosystem shares — Akasha (wallet), Hathor, the
// bots, and the claim page all call it. It speaks raw EVM JSON-RPC (eth_call) over the PRANA RPC,
// using hardcoded 4-byte selectors (so the lib needs no keccak and stays fully offline-testable).
// Signing stays client-side: buildRegisterTx/buildRenewTx return UNSIGNED {to,data,value} the
// caller's wallet signs — the resolver never sees a key. Pure, soft-fail, injectable fetch.

// read lazily so env set after import (and tests) take effect
const rpcUrlEnv = () => process.env.REN_RPC_URL || 'http://127.0.0.1:8545';
const registrarEnv = () => process.env.REN_REGISTRAR || '';

// function selectors (keccak256(sig)[0:4]) — computed once against the deployed ABI.
export const SEL = {
  resolve: '0x461a4478',        // resolve(string) -> address
  contenthashOf: '0x7000ec1e',  // contenthashOf(string) -> bytes32
  text: '0x0513c3e9',           // text(string,string) -> string
  available: '0xaeb8ce9b',      // available(string) -> bool
  priceOf: '0x67a60f37',        // priceOf(string,uint256,bool) -> uint256
  nameExpires: '0x05457b3d',    // nameExpires(string) -> uint64
  id: '0xf737948b',             // id(string) -> uint256
  ownerOf: '0x6352211e',        // ownerOf(uint256) -> address
  register: '0x9858ddb5',       // register(string,uint256,bool) payable
  renew: '0x4be2b2ec',          // renew(string,uint256,bool) payable
};

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

// ── hex / ABI primitives (pure) ──────────────────────────────────────────────────────────────
const strip0x = (h) => String(h || '').replace(/^0x/, '');
const padL = (h, n = 64) => strip0x(h).padStart(n, '0');
const padR = (h, n) => { const s = strip0x(h); return s + '0'.repeat((Math.ceil(s.length / n) * n) - s.length); };
function numToWord(n) { let h = BigInt(n).toString(16); return h.padStart(64, '0'); }
function utf8ToHex(s) { return Buffer.from(String(s), 'utf8').toString('hex'); }
function strWords(s) { // length word + right-padded data words
  const hex = utf8ToHex(s);
  const byteLen = hex.length / 2;
  return numToWord(byteLen) + (hex ? padR(hex, 64) : '');
}

// encode a single dynamic-string arg call: sel + offset(0x20) + len + data
function encString(sel, s) { return sel + numToWord(32) + strWords(s); }
// encode (string,uint256,bool): head[off=0x60, num, bool] + tail[string]
function encStrNumBool(sel, s, num, b) {
  return sel + numToWord(96) + numToWord(num) + numToWord(b ? 1 : 0) + strWords(s);
}
// encode (string,string): head[off1=0x40, off2] + tail[str1][str2]
function encStrStr(sel, a, b) {
  const w1 = strWords(a);
  const off2 = 64 + (w1.length / 2); // bytes: two head words (0x40) + str1 words
  return sel + numToWord(64) + numToWord(off2) + w1 + strWords(b);
}
// encode (uint256): sel + word
function encNum(sel, n) { return sel + numToWord(n); }

// decode helpers on a 0x-hex return blob
const wordAt = (hex, i) => strip0x(hex).slice(i * 64, i * 64 + 64);
function decAddress(hex) { const w = wordAt(hex, 0); return w ? '0x' + w.slice(24) : null; }
function decBool(hex) { return BigInt('0x' + (wordAt(hex, 0) || '0')) !== 0n; }
function decUint(hex) { const w = wordAt(hex, 0); return w ? BigInt('0x' + w) : 0n; }
function decBytes32(hex) { const w = wordAt(hex, 0); return w ? '0x' + w : null; }
function decString(hex) {
  const body = strip0x(hex);
  if (body.length < 128) return '';
  const len = Number(BigInt('0x' + body.slice(64, 128)));
  const data = body.slice(128, 128 + len * 2);
  try { return Buffer.from(data, 'hex').toString('utf8'); } catch { return ''; }
}

const ZERO = '0x0000000000000000000000000000000000000000';
const isZero = (a) => !a || /^0x0+$/.test(a);

// ── JSON-RPC eth_call (soft-fail → null) ─────────────────────────────────────────────────────
async function ethCall(data, { rpcUrl = rpcUrlEnv(), contract = registrarEnv() } = {}) {
  if (!contract) return null;
  try {
    const r = await _fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x' + strip0x(data) }, 'latest'] }),
    });
    const j = await r.json();
    if (!j || j.error || typeof j.result !== 'string') return null;
    return j.result;
  } catch { return null; }
}

// ── public read API (all soft-fail → null / safe) ────────────────────────────────────────────
export async function resolve(name, opts) {
  const r = await ethCall(encString(SEL.resolve, name), opts);
  const a = r && decAddress(r); return isZero(a) ? null : a;
}
export async function contenthash(name, opts) {
  const r = await ethCall(encString(SEL.contenthashOf, name), opts);
  const h = r && decBytes32(r); return isZero(h) ? null : h;
}
export async function textRecord(name, key, opts) {
  const r = await ethCall(encStrStr(SEL.text, name, key), opts);
  return r ? decString(r) : '';
}
export async function available(name, opts) {
  const r = await ethCall(encString(SEL.available, name), opts);
  return r ? decBool(r) : null;
}
export async function expires(name, opts) {
  const r = await ethCall(encString(SEL.nameExpires, name), opts);
  return r ? Number(decUint(r)) : null;
}
export async function price(name, years = 1, inKula = false, opts) {
  const r = await ethCall(encStrNumBool(SEL.priceOf, name, years, inKula), opts);
  return r ? decUint(r).toString() : null; // wei, as string (avoid BigInt JSON issues)
}
export async function tokenId(name, opts) {
  const r = await ethCall(encString(SEL.id, name), opts);
  return r ? decUint(r).toString() : null;
}
export async function owner(name, opts) {
  const idHex = await ethCall(encString(SEL.id, name), opts);
  if (!idHex) return null;
  const r = await ethCall(SEL.ownerOf + padL(wordAt(idHex, 0)), opts);
  const a = r && decAddress(r); return isZero(a) ? null : a;
}

// one-shot aggregate for a name card / lookup UI
export async function lookup(name, opts) {
  const [avail, addr, exp, chash] = await Promise.all([
    available(name, opts), resolve(name, opts), expires(name, opts), contenthash(name, opts),
  ]);
  return {
    name,
    available: avail,
    registered: avail === false,
    resolvesTo: addr,
    contenthash: chash,
    expires: exp,                                   // unix seconds (0 = never registered)
    expiresISO: exp ? new Date(exp * 1000).toISOString() : null,
  };
}

// ── unsigned tx builders (the wallet signs; we never touch keys) ─────────────────────────────
export function buildRegisterTx({ contract = registrarEnv(), name, years = 1, inKula = false, priceWei = '0' }) {
  return {
    to: contract,
    data: encStrNumBool(SEL.register, name, years, inKula), // selector already carries the 0x prefix
    value: inKula ? '0x0' : '0x' + BigInt(priceWei).toString(16), // PRANA path sends value; KULA path approves separately
  };
}
export function buildRenewTx({ contract = REGISTRAR, name, years = 1, inKula = false, priceWei = '0' }) {
  return {
    to: contract,
    data: encStrNumBool(SEL.renew, name, years, inKula),
    value: inKula ? '0x0' : '0x' + BigInt(priceWei).toString(16),
  };
}

export function configured() { return !!registrarEnv(); }
export const _internal = { encString, encStrNumBool, encStrStr, encNum, decAddress, decBool, decUint, decString, decBytes32 };
