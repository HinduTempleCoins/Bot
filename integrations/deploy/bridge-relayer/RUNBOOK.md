# MELEK Hive-Engine ⇄ PRANA Bridge Relayer — Runbook

The service that makes the wrapped-asset bridge **live**: it watches the HIVE custody account
**`@kula-bridge`** for VKBT/CURE deposits, attests them (3-of-5) on PRANA so `wVKBT`/`wCURE`
mint to the memo's `0x` address, and watches PRANA for wrapped burns to release the real
VKBT/CURE from custody (3-of-5 HIVE multisig).

- **Host:** `melek-prana` (Contabo). Local PRANA mainnet RPC `http://127.0.0.1:8557`.
- **Service:** `melek-bridge-relayer.service` (systemd, `Restart=always`, `enabled`).
- **Code:** `/root/PRANA/bridge-relayer/` (daemon + 4 pure watcher modules + node_modules).
- **Log:** `/var/log/melek-bridge-relayer.log`.
- **Source of truth in repo:** `integrations/hive-engine-bridge-daemon.mjs` (+ watchers).

## Chain / account facts (PRANA mainnet chainId 712217)

| Thing | Value |
|---|---|
| Custody (deposit target) | `@kula-bridge` on **HIVE** (active auth 3-of-5) |
| Bridged symbols | **VKBT, CURE** (Hive-Engine, precision 8; issuer `@kalivankush`) |
| GrapheneDepositBridge | `0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505` |
| ValidatorSet (3-of-5) | `0x7FE3897dFF8e28C8fa45DCe52DBfedF10368809E` |
| wVKBT (8dp) | `0xD915E757662c4234137aff167Bf93d588145f75e` |
| wCURE (8dp) | `0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff` |
| tokenId | `keccak256(symbol)` — `ethers.id("VKBT")` / `ethers.id("CURE")` |
| Hive-Engine ssc id | `ssc-mainnet-hive` (**real** Hive-Engine) |
| Bot's PRANA attesters (3-of-5) | `0xe75A81f6…`, `0xbbe03b8E…`, `0x7241Bd2c…` — all `isValidator==true` |
| Bot's HIVE custody signers (3-of-5) | pubs `STM8an3…`, `STM5AXEW…`, `STM5TmZG…` — all in `@kula-bridge` active auth |

**wMELEK is NOT bridged on this leg:** there is no `MELEK` token on Hive-Engine. wMELEK
(`0xf6d9BE28…`, 18dp) stays deployed-but-unfed until a MELEK source is provisioned (either a
Hive-Engine MELEK token, or the native-MELEK-chain relayer path with its own custody account —
`integrations/bridge-relayer-runner.mjs`, `bridge-withdrawal-runner.mjs`).

## Key custody (zero-WIF in repo)

The pure watcher modules hold **no keys**. The daemon loads the bot's 3 EVM validator privates +
3 HIVE custody WIFs **JIT** from two credential files whose paths come from env; the private
material is never logged (only derived addresses/pubs ever print). Nothing is committed to the repo.

The daemon runs in **WATCH-ONLY** mode until the creds are mounted — it polls, derives, and logs
what it *would* attest/release, but signs/submits nothing. This is the safe "verified-ready" state.

## Current state (2026-08-30)

`active (running)`, `enabled`, `0` restarts, **WATCH-ONLY** (no creds mounted → cannot move value,
honoring the STOP line). No deposits exist yet, so no attestations. Verified:
- attester addresses `isValidator==true` on the ValidatorSet (attestations will count),
- `requiredQuorum()==3`, bridge not paused, wrappers mapped to the right tokenIds,
- deposit-derivation dry-run: 100 VKBT → `amount=10000000000` (8dp), `tokenId=keccak("VKBT")`,
  `recipient=<memo 0x>`, `depositRef=<padded HE txid>` — a real deposit mints correctly.

## GO-LIVE (mount keys) — only on operator/coordinator "go"

```bash
ssh melek-prana
mkdir -p /root/PRANA/bridge-relayer/creds
# 1) put the two plaintext key JSONs on the box (root-only), then encrypt to tmpfs-only creds:
systemd-creds encrypt --name=bridge-validators   /path/validators.json    /root/PRANA/bridge-relayer/creds/bridge-validators.cred
systemd-creds encrypt --name=bridge-hive-signers /path/hive-signers.json  /root/PRANA/bridge-relayer/creds/bridge-hive-signers.cred
shred -u /path/validators.json /path/hive-signers.json      # plaintext never stays on disk
# 2) uncomment the 4 credential lines in the unit:
sed -i 's/^#\(Environment=BRIDGE_\|LoadCredentialEncrypted=\)/\1/' /etc/systemd/system/melek-bridge-relayer.service
systemctl daemon-reload && systemctl restart melek-bridge-relayer
journalctl -u melek-bridge-relayer -n 20 --no-pager    # expect "[he-bridge] LIVE. ... attesters=[0xe75A81f6,0xbbe03b8E,0x7241Bd2c]"
```
- `validators.json` shape: `{ bot_signing_set: { shared:{address,privateKey}, bot:[{address,privateKey}×2] } }`
  (this repo's `.local/vault/prana-bridge-validators.json`).
- `hive-signers.json` shape: `{ bot_side: { shared:{wif,pub}, bot:[{wif,pub}×2] } }`
  (this repo's `.local/vault/hive-bridge-signers.json`).

## First canary (after go-live) — a real deposit, tiny

Send a small VKBT amount to custody with a **bot-controlled** `0x` PRANA address in the memo:

```
Hive-Engine tokens.transfer:  to: kula-bridge   symbol: VKBT   quantity: 100
memo: 0x<your PRANA recipient address>
```
The relayer sees it within one tick (~30 s + `CONFIRMATIONS`), submits `attestDeposit` from all
3 bot keys → threshold 3 → **wVKBT mints 100.00000000 to the memo address**. Verify:
`cast call 0xD915…f75e "balanceOf(address)(uint256)" 0x<recipient>` == `10000000000`.

Reverse: `GrapheneDepositBridge.withdraw(keccak("VKBT"), amount, encodeBytes32String("<hiveacct>"))`
burns wVKBT → after `CONFIRMATIONS` the relayer releases VKBT from `@kula-bridge` (3-of-5), memo
`bridge-withdraw:<nonce>` (the idempotency marker).

### @angelicalist as the canary source
`@angelicalist` (the trade-bot account, holds ~86,992 VKBT / 1,632 CURE) can source the canary —
its **active** authority is a single key (`STM5y9kbpKt…`), stored at `.local/vault/hive-tradebot-keys.json`
and used live by the trade bot on the GCP e2-micro. Sign the `tokens.transfer` with that same active
key (JIT, never persisted). Move only a bounded slice; leave the trade bot its balance + RC and don't
collide with its in-flight ops.

## Ops

```bash
systemctl status melek-bridge-relayer
tail -f /var/log/melek-bridge-relayer.log
systemctl restart melek-bridge-relayer      # after a code update: re-scp the .mjs, then restart
```
Config lives in the unit's `Environment=` lines. `allowCustomJsonDeposits` is not applicable here —
the Hive-Engine watcher only recognises native `tokens_transfer` (value enforced by the sidechain),
never a raw custom_json deposit.
