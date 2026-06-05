# Zephyr (ZEPH) — pool + browser-mining integration (staging)

Operator directive (2026-06-05, Addendum 23): *"Put it on the Browser."* — add Zephyr (ZEPH,
RandomX, the recommended CPU/phone coin) to the SoapBox pool and surface it in the
browser-mining section (up-top coin picker), wizard, and launcher manifest.

This directory holds **Phase A** prep that does NOT touch shared, in-flight files
(`pool/www/`, `pool/bridge/`, the live Miningcore `config.json`). Phase B applies it once the
in-flight browser-mining PR has merged. Every artifact here is drop-in/ready.

---

## 1. Platform-support verdict (honest)

**Vanilla `oliverw/miningcore` CANNOT host Zephyr.** This is the same finding the pool README
already documents for VerusCoin — verified specifically for ZEPH:

- Zephyr is a Monero/CryptoNote fork with **asset-type extensions** (ZPH / ZSD / ZRS). Its
  block template uses a distinct serialization that requires **`cnBlobType: 13`**
  (`BLOB_TYPE_CRYPTONOTE_ZEPHYR`) and the custom **`zephyr-cryptoforknote-util`** blob parser.
- Miningcore's RandomX/CryptoNote path only understands the **Monero** blob format. There is a
  standing, unresolved Miningcore bug for exactly this (oliverw/miningcore#1704, "Zephyr is
  using randomx algo, pool wont accept miners"), and `oliverw/miningcore` was **archived
  read-only on 2023-10-20** — it will never gain ZEPH support. No trustworthy Miningcore-ZEPH
  fork exists; the **entire** ZEPH pool ecosystem (HeroMiners, 2miners, K1Pool, MiningOcean,
  HashVault, and the **official `ZephyrProtocol/zephyr-pool`**) runs on the
  **`cryptonote-nodejs-pool`** (Node.js) family, not Miningcore.

**Chosen path (already on the box, Addendum-5-compliant):** the existing **`melek-pool`**
container IS a `cryptonote-nodejs-pool` build (the README's "old pool", `node init.js`, ports
3333/5555, currently serving the Monero-stagenet RandomX demo). Adding ZEPH there as a
**childPool / dedicated pool instance behind the same SoapBox frontend** is exactly the
"temporary per-coin shim behind the same frontend" that operator Addendum 5 permits for
CryptoNote coins Miningcore can't host. Miningcore stays the platform for everything it CAN
host (Monero, Etchash/ETC, future PRANA); ZEPH rides the node-pool shim.

### The one required change for Phase B: rebuild the node-pool image with the Zephyr blob parser

The live `melek-pool` image was built from `cryptonote-nodejs-pool` with
`cryptoforknote-util` = **`git+https://github.com/MoneroOcean/node-cryptoforknote-util.git`**,
which has **no** blob type 13 (verified by grep inside the running image — no `case 13` /
`zephyr`). To host ZEPH, rebuild the image with that one dependency swapped to:

```
"cryptoforknote-util": "git+https://github.com/ZephyrProtocol/zephyr-cryptoforknote-util.git"
```

Verified present: `ZephyrProtocol/zephyr-cryptoforknote-util` (pushed 2024-10-10) ships
`src/cryptonote_config.h: BLOB_TYPE_CRYPTONOTE_ZEPHYR = 13`. This is the same util the official
`ZephyrProtocol/zephyr-pool` uses. The directive explicitly allows rebuilding from a fork.

> Build note: the ZEPH-patched node-pool should run as its **own** container
> (`melek-pool-zeph`) so the existing Monero-stagenet `melek-pool` (MoneroOcean util) is left
> untouched. Two node-pool containers, one frontend. The ZEPH container mounts
> `zephyr-pool.config.json` (below).

---

## 2. Daemon — DONE (Phase A, live on the pool host)

Zephyr **mainnet** daemon is up and syncing on the pool host. The host-specific operational
record (exact systemd unit with the pinned live peer IPs, box name) lives in
`.local/zephyr/melek-zephyrd.service` (private). Public summary:

- systemd unit `melek-zephyrd.service` — enabled, `Restart=always`, reboot-safe. Container
  `melek-zephyrd` on `melek-pool-net`, `nice -15`, `--cpus 1.5`.
- Official binary `zephyrd` v2.3.0 (from `zephyr-cli-linux-v2.3.0.zip`, SHA-pinned release);
  data dir **pruned** (`--prune-blockchain --sync-pruned-blocks`).
- RPC on the docker network only: `melek-zephyrd:17767` (not host-published). P2P 17766.
- The official hardcoded seed IPs in zephyrd v2.3.0 are **stale/closed** on all CryptoNote
  ports, so we pin currently-live public peers (zephyrprotocol remote-node, zeph.network,
  hashvault) as priority+seed nodes (exact addresses in the private unit file).
- Network tip at standup ≈ block **791,339**. The pruned chain is a few GB; ample disk free.

The release zip also contains **`zephyr-wallet-rpc`** and `zephyr-wallet-cli` (in
`/opt/melek-zephyr/bin/`) — used to stand up the pool payout wallet in Phase B.

---

## 3. Pool payout wallet (Phase B — non-custodial posture)

- Miners mine to **their own** ZEPH addresses (standard non-custodial CryptoNote pool; the
  address is the stratum username, never leaves the miner).
- The **pool payout wallet** is a FRESH, **zero-balance** ZEPH wallet generated **on the box**
  with `zephyr-wallet-rpc` / `zephyr-wallet-cli` — NEVER any existing/value keys. Command to
  run in Phase B (creates a new wallet, prints the primary address):

  ```sh
  # one-shot wallet creation on the box (interactive cli, throwaway zero-balance):
  docker run --rm -it --network melek-pool-net \
    -v /opt/melek-zephyr/bin:/zb:ro -v /opt/melek-zephyr/wallet:/wallet \
    ubuntu:22.04 /zb/zephyr-wallet-cli \
      --generate-new-wallet /wallet/pool-wallet \
      --daemon-address melek-zephyrd:17767 --trusted-daemon --mnemonic-language English
  # then run zephyr-wallet-rpc against it for the pool to query/pay from:
  #   /zb/zephyr-wallet-rpc --wallet-file /wallet/pool-wallet --daemon-address melek-zephyrd:17767 \
  #     --rpc-bind-ip 0.0.0.0 --confirm-external-bind --rpc-bind-port 17769 --disable-rpc-login
  ```

  Put the generated **primary address** into `wallet.address` + `poolServer.poolAddress` of
  `zephyr-pool.config.json`. Keep the wallet keys in the operator vault as a fresh entry
  (e.g. `zephyr-pool-wallet`); they are zero-value but should not be committed.

---

## 4. node-cryptonote-pool config — `zephyr-pool.config.json` (in this dir)

Ready-to-mount config for the ZEPH-patched node-pool container. Stratum ports **4447**
(CPU/low — browser/phone, aligned with the browser bridge's low-diff target) and **4448**
(high-end). `cnBlobType: 13`, `cnAlgorithm: randomx`, `isRandomX: true`,
`intAddressPrefix: 340` (ZEPH integrated-address prefix). Daemon `melek-zephyrd:17767`,
wallet `melek-zephyr-walletrpc:17769`. `poolAddress`/`wallet.address` are placeholders
(`__ZEPH_POOL_ADDRESS__`) filled from §3.

> Low-diff alignment: 4447 starts at difficulty 500 with varDiff floor 100, so a browser WASM
> miner or phone produces accepted shares quickly. Match the browser bridge's chosen low-diff
> port/realm when that PR lands; adjust the `4447` difficulty if the bridge expects a specific
> value.

---

## 5. Wizard / launcher data — `coin-entry.wizard.txt` (in this dir)

Drop-in `COINS.zephyr` entry for `pool/www/wizard.mjs` (the single source of truth that feeds
BOTH the per-coin wizard AND `buildManifest()` → `launcher-manifest.json`). Includes:

- `family: 'cryptonote'`, `algo: 'rx/0'`, `xmrigCoin: 'zephyr'` (xmrig has a native
  `--coin zephyr` profile, so the existing `genConfig`/`genOneLiners`/`genPhone`/`genQrPayload`
  all work unchanged), `phoneReady: true`.
- `addr: { type: 'zephyr' }` + a new branch in `validateAddress()` (ZEPH standard addresses
  start with **`ZEPHs`**, integrated **`ZEPHi`**, base58, ~97–98 chars).
- `walletHelp: 'https://wallet.zephyrprotocol.com/'` (official wallet).
- `launcher: { port: 4447, menuLabel: 'Zephyr (ZEPH) — CPU / phone', enabled: false, miner: 'xmrig', hardware: ['cpu'] }`
  — **`enabled: false`** until the daemon is synced + a test share accepts (then flip to
  `true` and regenerate the manifest with `node pool/www/build-manifest.mjs`).

After adding the COINS entry + the validateAddress branch, regenerate the static manifest:
`node pool/www/build-manifest.mjs` (auto-propagates ZEPH into every existing launcher download).

---

## 6. Browser-mining picker (Phase B, after the browser PR merges)

Add ZEPH to the up-top browser-mining coin picker (the browser agent's
`pool/www/browser-mine.mjs` / `miner.mjs` + the reordered `index.html`). ZEPH is RandomX —
the same WASM RandomX miner + WebSocket→stratum bridge path as Monero, pointed at the ZEPH
low-diff stratum port (4447). Surface it **up top** per Addendum 22. Honest physics copy
(browser WASM ~10–50× slower, phone throttling, fractions of a cent) applies identically.

---

## 7. README path fix (Phase B, in the same PR)

`pool/README.md` documents the frontend deploy target as `/opt/melek-miningcore/www`
(lines ~89, 125, 148). The **real** web root is **`/opt/melek-pool/www`** (confirmed on the
box — both dirs exist and are rsync'd, but `/opt/melek-pool/www` is the live SoapBox pool
front). Fix every `/opt/melek-miningcore/www` → `/opt/melek-pool/www` in the README when the
browser PR's README edits have landed (avoid clobbering its in-flight README changes).

---

## Phase B checklist (one place)

- [ ] Confirm `melek-zephyrd` reached the tip (`get_info` height ≈ target).
- [ ] Generate the fresh zero-balance pool wallet (§3); fill `__ZEPH_POOL_ADDRESS__`.
- [ ] Rebuild node-pool image with `zephyr-cryptoforknote-util`; run as `melek-pool-zeph`
      mounting `zephyr-pool.config.json`; open UFW 4447/4448.
- [ ] Add `COINS.zephyr` + `validateAddress` ZEPH branch to `pool/www/wizard.mjs`; flip
      `enabled: true`; `node pool/www/build-manifest.mjs`; `node --test pool/www/*.test.mjs`.
- [ ] Add ZEPH to the browser-mining picker UP TOP + wizard UI.
- [ ] Deploy frontend to **`/opt/melek-pool/www`**; fix the README path.
- [ ] Proof: an accepted ZEPH share (brief nice'd xmrig `--coin zephyr` to 4447, or via the
      browser bridge once live). If still syncing, leave staged-with-one-command-enable.
