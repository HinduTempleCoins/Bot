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

---

## Security review — `keystore.mjs` (optional encrypted browser copy)

`keystore.mjs` is an **opt-in** layer added on top of the default zero-secret custody model.
It does **not** change the default: by default the seed is shown once, the user is quizzed to
prove they wrote it down, and only the public **address** is persisted. The keystore only ever
exists if a user, *after* passing the paper-backup gate, explicitly chooses "also keep an
encrypted copy in this browser."

### Cryptographic design

- **Cipher:** AES-256-GCM (`crypto.subtle`, WebCrypto). GCM is authenticated — its 128-bit
  auth tag gives tamper detection for free (any mutated ciphertext/IV fails `decrypt`).
- **KDF:** PBKDF2-HMAC-SHA-256, **600,000 iterations** (MetaMask-grade work factor), 16-byte
  random salt. Derives a 256-bit AES key from the user password.
- **Per-encryption randomness:** a fresh 16-byte salt **and** 12-byte IV are drawn from
  `crypto.getRandomValues` on every `encryptSeed`. (Same secret + same password ⇒ different
  ciphertext every time; no IV/salt reuse.)
- **Keystore JSON:** `{ v:1, kdf:'PBKDF2-SHA256', iters:600000, salt, iv, ct }` — all binary
  fields base64. **Ciphertext only.** There is no plaintext field; `saveKeystore` actively
  refuses to persist any record carrying a `secret`/`mnemonic`/`privateKey`/`seed` field.
- **Zero dependencies:** WebCrypto only. No npm package, no WASM blob to trust, nothing to
  supply-chain-compromise. (Same posture as the rest of `walletgen`.)
- **Failure is opaque:** a wrong password and a tampered ciphertext both surface the *same*
  `"wrong password or corrupted keystore"` error — we never disclose which.

### Session / lock semantics (compatible with Akasha AK5 §3)

- `unlock(password)` decrypts and holds the secret **in module memory only** (a `Uint8Array`),
  never on disk. `lock()` zeroizes that buffer (`.fill(0)`) and drops the reference.
- **Idle auto-lock:** after N minutes (default 10) with no activity the session zeroizes
  itself. The clock and timer are injectable so this is deterministically tested.
- **Re-auth per outflow:** the unlocked secret is not an ambient session for spending — an
  outflow re-prompts for the password (`unlock` again at spend time), matching AK5 §3's
  "unlocking for an outflow requires the password."
- The decrypted secret is **never** written to any storage on unlock (tested).

### Threat model

- **XSS = game over — for ANY browser wallet, this one included.** If an attacker can run
  JavaScript in the page's origin, they can read the unlocked secret from memory, hook the
  password field, or exfiltrate the keystore + brute-force it offline. No in-browser crypto
  design survives script injection. The keystore raises the bar against *device theft / disk
  inspection* (ciphertext at rest under a 600k-iter KDF), **not** against code running in-page.
  - **Mitigation = keep scripts out.** The wallet page ships **no external scripts and no
    telemetry** (only same-origin ES modules + the inline theme bootstrap; enforced by a test).
    Production should serve a strict **Content-Security-Policy** (`script-src 'self'`, no
    `unsafe-inline`/`unsafe-eval`, `connect-src 'self'`) so injected/remote script cannot run.
- **Weak password:** PBKDF2-600k slows offline guessing but cannot save a guessable password.
  We enforce a length floor (≥10) and show an **honest** strength meter (length-dominant, no
  fake "must contain a symbol" rules). A forgotten password is **unrecoverable** — the paper
  backup is the only recovery, stated plainly in the UI.
- **Clipboard leak:** if a "copy seed" affordance is offered, `scheduleClipboardClear` wipes
  the clipboard ~60s after copy (best-effort; only if the clipboard still holds what we wrote,
  so it never clobbers a later copy). The browser may deny clipboard writes to an unfocused
  tab, so the UI still warns the user — clipboard is the least-safe path and paper is preferred.
- **At-rest disk inspection:** `localStorage` holds ciphertext only; without the password it is
  a 256-bit-AES blob behind a 600k-iter KDF.
- **Pool/server trust:** the pool never receives the password or the seed. Encryption,
  decryption, and storage are entirely client-side; the server's view is unchanged (it still
  only ever sees the public receive address).

### Out of scope (by design)

- No password reset / recovery, no "export everything," no server-side escrow — all of these
  would re-introduce a custody surface the design exists to avoid.
- Signing is still not implemented on this hot surface; the keystore protects a stored secret
  at rest, it does not turn the page into a transaction signer.
