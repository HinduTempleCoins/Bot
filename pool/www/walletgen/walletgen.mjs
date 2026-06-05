// walletgen.mjs — client-side, non-custodial wallet generation for the pool-as-wallet.
//
// Generates a fresh wallet (keys + receive address) for each supported coin, entirely in
// the browser (or under node --test). Keys NEVER leave the device: there is no network
// call here and no telemetry. The pool only ever sees the RECEIVE ADDRESS (as the mining
// payout username) — never the seed or spend key.
//
// Coin families:
//   - cryptonote (Monero, Zephyr): 25-word Monero-style seed -> spend/view keys -> address.
//     Vendored, dependency-free keccak/ed25519/base58/mnemonic, verified against Monero
//     address test vectors (see walletgen.test.mjs).
//   - evm (Ethereum Classic now, PRANA later): one secp256k1 keypair -> one EIP-55 address
//     that covers EVERY EVM chain (the same address works on ETC, PRANA, etc.).
//
// `randomBytes` is injected so callers control entropy: the browser passes
// crypto.getRandomValues; tests pass a deterministic source to check against vectors.

import { keccak256 } from './vendor/keccak.mjs';
import { scReduce32, scalarmultBase } from './vendor/ed25519.mjs';
import { makeAddress } from './vendor/cn-address.mjs';
import { bytesToMnemonic, mnemonicToBytes } from './vendor/mnemonic.mjs';
import { publicKeyFromPrivate, isValidPrivateKey, SECP256K1_N } from './vendor/secp256k1.mjs';

// ---------------------------------------------------------------------------
// Coin registry. `addressTag` is the CryptoNote network varint (mainnet) for cryptonote
// coins. EVM coins share one keypair, so no per-coin tag is needed.
// CryptoNote tags sourced from each project's cryptonote_config.h:
//   Monero mainnet CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX = 18
//   Zephyr mainnet CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX = 0x6241d18c0
// ---------------------------------------------------------------------------
export const WALLET_COINS = {
  zephyr: {
    symbol: 'ZEPH', name: 'Zephyr', family: 'cryptonote',
    addressTag: 0x6241d18c0n, addrLabel: 'ZEPH (starts "ZEPH")',
  },
  monero: {
    symbol: 'XMR', name: 'Monero', family: 'cryptonote',
    addressTag: 18n, addrLabel: 'XMR (starts "4")',
  },
  ethereum_classic: {
    symbol: 'ETC', name: 'Ethereum Classic', family: 'evm',
    addrLabel: 'EVM 0x… (covers all EVM chains)',
  },
};

export function resolveWalletCoin(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  if (WALLET_COINS[k]) return { key: k, ...WALLET_COINS[k] };
  for (const [ck, c] of Object.entries(WALLET_COINS)) {
    if (c.symbol.toLowerCase() === k) return { key: ck, ...c };
  }
  return null;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};

// Default browser entropy source. Throws if no CSPRNG is available (we never fall back to
// Math.random for key material).
function defaultRandomBytes(n) {
  const g = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (g && typeof g.getRandomValues === 'function') {
    const b = new Uint8Array(n);
    g.getRandomValues(b);
    return b;
  }
  throw new Error('No secure RNG available (crypto.getRandomValues). Refusing to generate keys.');
}

// ---------------------------------------------------------------------------
// CryptoNote (Monero / Zephyr) wallet.
// ---------------------------------------------------------------------------
export function generateCryptonoteWallet(coin, { randomBytes = defaultRandomBytes } = {}) {
  const c = resolveWalletCoin(coin);
  if (!c || c.family !== 'cryptonote') throw new Error('not a cryptonote coin');

  // Spend key = sc_reduce32(random 32 bytes). The mnemonic encodes this reduced key, so the
  // seed shown to the user round-trips exactly (deterministic wallet).
  const spendKey = scReduce32(randomBytes(32));
  const viewKey = scReduce32(keccak256(spendKey)); // Monero deterministic view key
  const pubSpend = scalarmultBase(spendKey);
  const pubView = scalarmultBase(viewKey);
  const address = makeAddress({ tag: c.addressTag, pubSpend, pubView });
  const mnemonic = bytesToMnemonic(spendKey);

  return {
    coin: c.key, symbol: c.symbol, name: c.name, family: 'cryptonote',
    address,
    mnemonic,                                   // 25 words — THE backup. Show once.
    secretSpendKey: toHex(spendKey),
    secretViewKey: toHex(viewKey),
    publicSpendKey: toHex(pubSpend),
    publicViewKey: toHex(pubView),
  };
}

// Recover a cryptonote wallet from its 25-word mnemonic (for the "restore" path + tests).
export function recoverCryptonoteWallet(coin, mnemonic) {
  const c = resolveWalletCoin(coin);
  if (!c || c.family !== 'cryptonote') throw new Error('not a cryptonote coin');
  const spendKey = mnemonicToBytes(mnemonic); // already a reduced scalar
  const viewKey = scReduce32(keccak256(spendKey));
  const pubSpend = scalarmultBase(spendKey);
  const pubView = scalarmultBase(viewKey);
  return {
    coin: c.key, symbol: c.symbol, name: c.name, family: 'cryptonote',
    address: makeAddress({ tag: c.addressTag, pubSpend, pubView }),
    mnemonic: bytesToMnemonic(spendKey),
    secretSpendKey: toHex(spendKey),
    secretViewKey: toHex(viewKey),
    publicSpendKey: toHex(pubSpend),
    publicViewKey: toHex(pubView),
  };
}

// ---------------------------------------------------------------------------
// EVM (Ethereum Classic, PRANA, any EVM chain) wallet. One keypair -> one address that is
// valid on every EVM chain. The private key (hex) is the backup secret.
// ---------------------------------------------------------------------------

// EIP-55 mixed-case checksum address from the 20 raw address bytes.
export function toChecksumAddress(addr20) {
  const hex = (typeof addr20 === 'string' ? addr20.replace(/^0x/, '') : toHex(addr20)).toLowerCase();
  const hash = toHex(keccak256(new TextEncoder().encode(hex)));
  let out = '0x';
  for (let i = 0; i < hex.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function evmAddressFromPrivate(priv32) {
  const pub = publicKeyFromPrivate(priv32);      // 64 bytes, X||Y
  const addr20 = keccak256(pub).subarray(12);    // last 20 bytes of keccak(pub)
  return toChecksumAddress(addr20);
}

export function generateEvmWallet(coin, { randomBytes = defaultRandomBytes } = {}) {
  const c = resolveWalletCoin(coin);
  if (!c || c.family !== 'evm') throw new Error('not an evm coin');
  // Draw a private key in (0, N). Reject-and-retry on the (astronomically rare) out-of-range.
  let priv;
  for (let tries = 0; tries < 8; tries++) {
    const candidate = randomBytes(32);
    if (isValidPrivateKey(candidate)) { priv = candidate; break; }
  }
  if (!priv) throw new Error('failed to draw a valid secp256k1 key');
  return {
    coin: c.key, symbol: c.symbol, name: c.name, family: 'evm',
    address: evmAddressFromPrivate(priv),
    privateKey: '0x' + toHex(priv),               // THE backup. Covers all EVM chains.
    note: 'This one private key controls this address on EVERY EVM chain (ETC, PRANA, …).',
  };
}

export function recoverEvmWallet(coin, privateKeyHex) {
  const c = resolveWalletCoin(coin);
  if (!c || c.family !== 'evm') throw new Error('not an evm coin');
  const priv = fromHex(privateKeyHex);
  if (priv.length !== 32 || !isValidPrivateKey(priv)) throw new Error('invalid EVM private key');
  return {
    coin: c.key, symbol: c.symbol, name: c.name, family: 'evm',
    address: evmAddressFromPrivate(priv),
    privateKey: '0x' + toHex(priv),
    note: 'This one private key controls this address on EVERY EVM chain (ETC, PRANA, …).',
  };
}

// ---------------------------------------------------------------------------
// Unified entry: generate a wallet for any registered coin.
// ---------------------------------------------------------------------------
export function generateWallet(coin, opts = {}) {
  const c = resolveWalletCoin(coin);
  if (!c) throw new Error(`unknown coin: ${coin}`);
  return c.family === 'cryptonote'
    ? generateCryptonoteWallet(coin, opts)
    : generateEvmWallet(coin, opts);
}

// The honest custody copy shown alongside every generated wallet.
export const CUSTODY_NOTICE =
  'This wallet was created on YOUR device, in your browser. The pool never sees or stores ' +
  'your secret — it only ever sees your receive address (your mining payout username). ' +
  'Write down your backup phrase / private key now and keep it offline. If you lose it, ' +
  'NO ONE — not the pool, not us — can recover it or your funds.';

export const SECP256K1_ORDER = SECP256K1_N;
