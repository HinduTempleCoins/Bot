# walletgen — vendored crypto provenance & license

The wallet generator runs **entirely client-side**: keys are derived in the user's browser
and never transmitted. To keep it dependency-free in the browser (no npm install, no WASM
blob to trust), the cryptographic primitives are vendored here as small, clean-room ESM
files. Each is verified against **published test vectors** in `pool/www/walletgen.test.mjs`
so a regression breaks the build, not a user's funds.

| File | What it is | Provenance | License |
|---|---|---|---|
| `vendor/keccak.mjs` | Keccak-256 (**original** Keccak, 0x01 pad — NOT NIST SHA3-256) | Clean-room Keccak-f[1600], 32-bit (hi/lo) unrolled lane form (js-sha3 lineage, Chen Yi-Cyuan) | Public domain / MIT-style |
| `vendor/ed25519.mjs` | ed25519 `scReduce32` + `scalarmultBase` (public-key derivation only; no signing) | Clean-room BigInt Twisted-Edwards arithmetic, RFC 8032 constants | CC0 |
| `vendor/cn-base58.mjs` | CryptoNote **block-based** base58 (not Bitcoin base58) | Clean-room port of Monero `src/common/base58.cpp` | CC0 |
| `vendor/cn-address.mjs` | CryptoNote address assembly (varint tag + pubkeys + keccak checksum) | Clean-room, mirrors Monero `get_account_address_as_str` | CC0 |
| `vendor/english-wordlist.mjs` | Monero English mnemonic word list (1626 words) | Verbatim from monero-project `src/mnemonics/english.h` | BSD-3 (Monero) |
| `vendor/mnemonic.mjs` | Monero 25-word seed ↔ 32-byte secret (CRC32 checksum word) | Clean-room, mirrors Monero `electrum_words.cpp` | CC0 |
| `vendor/secp256k1.mjs` | secp256k1 public-key derivation (EVM addresses; no signing) | Clean-room BigInt affine arithmetic, SEC2 constants | CC0 |

## Verified test vectors (see `walletgen.test.mjs`)

- **Keccak-256**: `""` → `c5d246…a470`; `"abc"` → `4e0365…6c45`.
- **ed25519**: priv `af6082…3206` → pub `7aff30…1236` (Monero vector).
- **Full Monero address**: pubspend `7aff30…1236` + pubview `25c1b6…4a63` →
  `46HSxE7KoiDaxWFWR1wmJfcrunNj4TLiPJqiCJkQn345A4JJzgBNhUvbkrYWJX4EVJZS4kJGfGj7CTW8GEUHsbEZCEupMt6`.
- **Mnemonic end-to-end**: the published 25-word phrase →
  spend `0b7a7b…2d00`, view `75ec66…a609`, pubspend `d5db20…2275`, pubview `cd235f…ae39`.
- **secp256k1 / EVM**: privkey 1 → `0x7e5f4552091a69125d5dfcb7b8c2659029395bdf`;
  privkey 2 → `0x2b5ad5c4795c026514f8317c7a215e218dccd6cf`; EIP-55 casing per the spec example.

## Network parameters

CryptoNote address tags (mainnet `CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX`, from each
project's `cryptonote_config.h`):

- **Monero**: `18` → addresses start `4`.
- **Zephyr**: `0x6241d18c0` → addresses start `ZEPH` (101 chars). (Zephyr's *subaddress*
  prefix `0x8dd58c0` yields the `ZEPHs…` 99-char form seen in some docs; the standard public
  address is the `0x6241d18c0` form generated here.)

EVM: one secp256k1 keypair → one EIP-55 address valid on **every** EVM chain (ETC now,
PRANA later) — there is no per-chain address.

## Scope / safety notes

- These modules do **public-key derivation only**. There is no transaction-signing code
  here, by design — the hot pool site is receive-only (per `PRANA_MINING_POOL_AS_WALLET`
  §6: spend keys stay off the hot side).
- Key material uses `crypto.getRandomValues` in the browser; the generators **refuse** to
  run without a secure RNG (no `Math.random` fallback for secrets).
- BigInt-based curve ops are simple double-and-add (not constant-time). That is acceptable
  here because keys are generated once, locally, from fresh CSPRNG entropy and are not used
  for signing on this surface; for hardware-wallet / signing paths use Akasha proper.
