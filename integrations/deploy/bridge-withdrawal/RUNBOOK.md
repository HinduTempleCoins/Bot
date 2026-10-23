# MELEK Bridge Withdrawal (redeem/exit) Leg — Runbook

**What this is.** The PRANA → MELEK exit leg. A holder who has wMELEK on PRANA burns it via
`GrapheneDepositBridge.withdraw(tokenId, amount, destinationRef)`; this daemon watches that
`GrapheneWithdrawal` event and RELEASES native MELEK from the bridge custody account to the
destination Graphene account — once per nonce, after a deep PRANA confirmation.

Without this daemon there is **no operable way to get native MELEK back out** of the wrapper. The
release logic is `integrations/bridge-withdrawal-runner.mjs` (pure, tested); the daemon
`integrations/bridge-withdrawal-daemon.mjs` adds the two impure edges (PRANA read + custody
broadcast). Offline tests: `bridge-withdrawal-runner.test.mjs` (release logic) and
`bridge-withdrawal-daemon.test.mjs` (edge/boundary).

> **DO NOT enable this until wMELEK is reconciled and custody is funded.** Releasing native MELEK
> against unbacked wMELEK drains real MELEK from custody. Fix backing first
> (see `.local/incoming/GET_IT_WORKING_STATUS.md` §STAGED and the reconciliation watchdog), stand
> up the reconciliation alarm, and only then run a single canary before opening it to volume.

## Preconditions (operator, before enabling)

1. **Backing reconciled.** `integrations/bridge-reconciliation.mjs` reports `backed` for wMELEK
   (`minted ≤ custodied`). Run `node integrations/bridge-reconciliation.mjs` — it exits non-zero on a
   shortfall.
2. **Custody funded.** `MELEK_BRIDGE_CUSTODY` is the real K-of-N account with native MELEK locked to
   cover circulating wMELEK — **not** the 1-MELEK `wmelek-bridge` stub.
3. **Custody master available** as an encrypted systemd credential (below). The active key is derived
   JIT and never written to disk.
4. **K co-signers.** For a K-of-N release federation, run K instances (one per custody co-signer key).
   Each is idempotent per nonce.

## Install

```
# on the custody host
cp integrations/deploy/bridge-withdrawal/melek-bridge-withdrawal.service \
   /etc/systemd/system/melek-bridge-withdrawal.service
cp integrations/deploy/bridge-withdrawal/bridge-withdrawal.env.example \
   /root/Bot/creds/bridge-withdrawal.env
# edit /root/Bot/creds/bridge-withdrawal.env — real RPC URLs, funded custody account, MELEK_CHAIN_ID

# encrypt the custody master password (plaintext file, one line, no trailing newline)
systemd-creds encrypt --name=bridge-withdrawal-master \
   /path/to/plaintext-master /root/Bot/creds/bridge-withdrawal-master.cred
shred -u /path/to/plaintext-master        # never leave it on disk

systemctl daemon-reload
```

## Canary (prove one round-trip before opening to volume)

1. Start ONE instance: `systemctl start melek-bridge-withdrawal` and `journalctl -fu melek-bridge-withdrawal`.
2. From a test PRANA wallet holding a small amount of wMELEK, call
   `bridge.withdraw(keccak("MELEK"), <tiny amount>, encodeBytes32String("<your-melek-account>"))`.
3. Wait `CONFIRMATIONS` PRANA blocks. The log should print `released #<nonce> -> <account> <amount>`.
4. Confirm native MELEK arrived: read the destination account on `MELEK_RPC_URL`
   (`condenser_api.get_accounts`), and confirm the wMELEK supply dropped by the burned amount
   (reconciliation stays balanced).
5. Only after a clean canary, bring up the remaining K−1 co-signer instances.

## Failure modes (all soft-fail, logged with a reason)

- **`tick not ok: <reason>`** — PRANA read failed (RPC down / bad address). No release attempted.
- **`N failed this tick`** — a broadcast threw (custody key wrong, insufficient balance, node
  rejected). The nonce is left UNreleased and retried next tick. Distinct reasons are logged.
- **skipped `non-native-token`** — a withdrawal for a non-wMELEK wrapper; released elsewhere.
- **skipped `awaiting-deep-prana-confirmation`** — not enough PRANA confirmations yet.

## Stop / pause

`systemctl stop melek-bridge-withdrawal` halts releases immediately (idempotent per nonce, so a
restart resumes without double-releasing). To also stop MINTING during an incident, pause the bridge
itself (`GrapheneDepositBridge.pause()`, PAUSER_ROLE) — see the reconciliation watchdog's guarded
pause path and `.local/incoming/GET_IT_WORKING_STATUS.md`.
