# Zephyr (ZEPH) browser-wallet — library survey + chosen approach

Re-run of the "good browser wallet for ZEPH" doc search (recovered-queue item), now that the
pool's in-browser wallet is already built at `pool/www/wallet/`. Question this note answers:
is the approach we shipped the right one, or is there a better browser-compatible library?

## What we already ship (and why it's the right call)

The pool wallet generates ZEPH addresses **client-side, dependency-free**:

- `pool/www/walletgen/walletgen.mjs` — the coin registry. ZEPH entry uses the CryptoNote
  network varint `addressTag: 0x6241d18c0n` (from Zephyr's `cryptonote_config.h`,
  `CRYPTONOTE_PUBLIC_ADDRESS_BASE58_PREFIX` — the multi-byte prefix is exactly why ZEPH
  addresses begin `ZEPH`).
- `pool/www/walletgen/vendor/cn-address.mjs` — the CryptoNote base58 + varint address
  codec (`makeAddress` / `parseAddress`), shared with Monero.
- Validation lives in `pool/www/wizard.mjs` (`validateAddress`, `addr.type: 'zephyr'`):
  base58, ~97–98 chars, `ZEPHs` / `ZEPHi` prefixes.

This is the same primitive Monero uses on this site, so ZEPH cost us only a registry row +
a varint — no new dependency, no WASM blob, keys never leave the browser (custody boundary
intact). For a **non-custodial mining pool whose only job is "make the miner an address they
control,"** that is the correct, minimal approach. Generating a spend/view keypair + encoding
the address is all the pool needs; it never has to sync, scan, or spend on the user's behalf.

## Libraries surveyed (the alternative, heavier paths)

- **`ZephyrProtocol/zephyr-javascript`** — Zephyr's fork of `monero-javascript`. RPC +
  WebAssembly bindings to zephyr core; supports client-side wallets in Node and the browser,
  multisig/view-only/offline wallets, tx/transfer/output queries, and block/sync
  notifications. This is the full-fat wallet SDK. URL:
  <https://github.com/ZephyrProtocol/zephyr-javascript>
  - **Verdict:** overkill for the pool. It pulls a large WASM core (full wallet2 surface) to
    do balance scanning and spending we explicitly do **not** want the pool browser doing.
    The right tool **if/when** we want an in-browser "see balance + send ZEPH" wallet (the
    My Coins "Send" path is currently a deep-link out, by design). Keep it on the bench for
    that future feature; do not add it for address generation.
- **`ZephyrProtocol/zephyr-wallet`** — the official React/Redux/Electron GUI wallet (desktop
  + web build); the hosted web version is <https://wallet.zephyrprotocol.com/> (the
  `walletHelp` link the wizard already points at). It is an *application*, not a library to
  embed — useful as the "official wallet" hand-off, not for our own generator.
- Official daemon/CLI side-tools (`zephyr-wallet-rpc`, `zephyr-wallet-cli`) — server-side,
  used on the pool box to stand up the zero-balance **payout** wallet (see
  `ZEPHYR_INTEGRATION.md` §3). Not a browser path.

## Conclusion

**Keep the current approach.** The dependency-free client-side generator (walletgen +
cn-address varint) is correct and lowest-risk for the pool's non-custodial, address-only
need, and it matches how Monero already works here. The one library worth bookmarking is
`ZephyrProtocol/zephyr-javascript` — adopt it only if we later build an in-browser
balance/send ZEPH wallet, where its WASM wallet core earns its weight.

## Sources

- <https://github.com/ZephyrProtocol/zephyr-javascript>
- <https://github.com/ZephyrProtocol/zephyr-wallet>
- <https://wallet.zephyrprotocol.com/>
- <https://github.com/ZephyrProtocol/zephyr>
