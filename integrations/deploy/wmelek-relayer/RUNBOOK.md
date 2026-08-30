# MELEK L1 → MELEK-Engine WMELEK Relayer — Runbook

**STATUS: STAGED (built + tested, NOT live).** This is the missing bootstrap on-ramp that
lets anyone get **WMELEK onto the MELEK-Engine** so they can forever-lock it → APIS-Hash →
mine APIS. Without it there is **no way to mint engine WMELEK on mainnet** (the bridge
invariant `allowTestnetFreeIssue=false` forbids free issuance), which blocks all APIS minting.

The relayer watches an L1 **custody account** for native MELEK deposits and drives the engine's
`bridge.mintWrapped` via a Graphene `custom_json`, **signed by the bridge account `@hathor`
through MELEK-Signer** (a scoped, revocable bearer token — the relayer never holds `@hathor`'s
WIF). It is the engine mirror of `integrations/bridge-relayer.mjs` (which targets the PRANA
ERC-20 instead).

## Files

| Path | Role |
|---|---|
| `integrations/wmelek-relayer.mjs` | Pure derivation: deposit detection, depositRef, amount precision, `buildMintOp`, `planMint`. Holds no key. |
| `integrations/wmelek-relayer-runner.mjs` | The loop: MELEK RPC read, finality gate, idempotent seen-set, resumable `lastBlock` cursor, injectable `submit`. |
| `integrations/wmelek-relayer-daemon.mjs` | Production entry. Wires real `fetch` + the MELEK-Signer client broadcast at the edge. |
| `integrations/wmelek-relayer.test.mjs` / `*-runner.test.mjs` | Offline `node --test` suites (37 tests). |
| `integrations/deploy/wmelek-relayer/melek-wmelek-relayer.service` | The staged systemd unit. |

## The deposit / custody convention

A user **"gets WMELEK"** by transferring native **MELEK on L1** to the custody account with a
memo naming their engine recipient:

```
transfer:  from: <you>   to: wmelek-bridge   amount: 1.234 MELEK
memo:      <engine-account-to-credit>      # leave BLANK to credit yourself (the depositor)
```

- **Custody account:** `wmelek-bridge` (env `WMELEK_BRIDGE_CUSTODY`). Mirrors `@kula-bridge`.
  **The operator must create this L1 account 3-of-5 before go-live** — the relayer never creates it.
- **Memo = the engine account to receive WMELEK.** A leading `@` is stripped. A **blank** memo
  credits the depositor (`from`). A **non-blank but invalid** memo is skipped (fail-closed — no
  silent fallback), and the deposit is not minted (operator can refund from custody).
- **Only native `transfer` deposits are honored.** A `custom_json` "deposit" is rejected: it moves
  no value on L1 and its fields are attacker-controlled (the wLEO-class gateway-mint hazard). Real
  MELEK must actually move to custody for the mint to happen.
- **Precision is 1:1.** MELEK L1 native is 3dp; the engine WMELEK side token is 3dp
  (`bridge.mjs ensureWrapped` → precision 3). No scaling — `1.234 MELEK` → `1.234 WMELEK`.
- **`depositRef` = the L1 tx id.** Globally unique; `bridge.mintWrapped` is idempotent per
  `depositRef`, so replaying the relayer can never double-mint.

## The mint op the relayer broadcasts

For each new **finalized** deposit, one Graphene `custom_json`, signed by `@hathor` (ACTIVE auth):

```json
["custom_json", {
  "required_auths": ["hathor"],
  "required_posting_auths": [],
  "id": "mse-mainnet-melek",
  "json": "{\"contractName\":\"bridge\",\"contractAction\":\"mintWrapped\",\"contractPayload\":{\"to\":\"<recipient>\",\"amount\":\"1.234\",\"depositRef\":\"<L1 tx id>\"}}"
}]
```

`bridge.mintWrapped` is bridge-account-only, ACTIVE-auth (see `engine/lib/engine.mjs`
`ACTIVE_REQUIRED`), and idempotent. It auto-creates WMELEK (issuer `hathor`, 3dp) on first mint.

## Key custody (zero-WIF in repo, MELEK-Signer only)

The relayer holds **no WIF**. `@hathor`'s active key lives **only inside MELEK-Signer**. The
daemon holds **only** the scoped bearer token (`MELEK_SIGNER_TOKEN`) and calls
`POST <signer>/v1/broadcast`. The signer's policy engine can revoke the token; `createSignerClient`
refuses a token that looks like a raw key. This satisfies the HARD rule *"all witness tx via
MELEK-Signer."*

The daemon **exits (stays DOWN, safe)** until `MELEK_SIGNER_URL` + `MELEK_SIGNER_TOKEN` +
`MELEK_RPC_URL` are all present. Missing token ⇒ no broadcast, ever.

## GO-LIVE PREREQUISITES (all three required)

Turning this on is gated on:

1. **The MELEK-Signer keepAlive fix** — a scoped, long-lived `@hathor` token that stays live for a
   background daemon (the "auto-system signer" gap; see the signer's own runbook). Until the token
   can be minted + kept alive, the daemon has nothing valid to broadcast with.
2. **The custody account `wmelek-bridge` exists** — operator-authorized, created 3-of-5 on L1
   (mirroring `@kula-bridge`). The relayer does **not** create it (STOP line: never create accounts
   or move value).
3. **The mainnet engine is deployed** — `NET=mainnet`, `mse-mainnet-melek` streaming L1, so the
   broadcast `custom_json` actually lands and `bridge.mintWrapped` executes.

## GO-LIVE steps (only on operator "go", after all three above)

```bash
# 0) operator: create the custody account 3-of-5 on L1 (NOT done here)
#    account: wmelek-bridge   (active auth = 3-of-5, same custodians as @kula-bridge)

# 1) mint the SCOPED @hathor signer token (custom_json + mse-mainnet-melek sidechain + active role),
#    on the signer box — NEVER a WIF, NEVER on this repo/box. Write it to a plaintext file, then:
ssh <deploy-box>
mkdir -p /root/Bot/creds
systemd-creds encrypt --name=wmelek-signer-token /path/token.txt /root/Bot/creds/wmelek-signer-token.cred
shred -u /path/token.txt                       # plaintext token never stays on disk

# 2) install + enable the unit, uncomment the signer lines, set the real signer URL:
cp integrations/deploy/wmelek-relayer/melek-wmelek-relayer.service /etc/systemd/system/
sed -i 's/^#\(Environment=MELEK_SIGNER_URL\|Environment=MELEK_SIGNER_TOKEN\|LoadCredentialEncrypted=\)/\1/' \
  /etc/systemd/system/melek-wmelek-relayer.service
# edit MELEK_SIGNER_URL= to the real signer base URL (e.g. https://signer.melek.salon)
systemctl daemon-reload
systemctl enable --now melek-wmelek-relayer
journalctl -u melek-wmelek-relayer -n 20 --no-pager
# expect: "[wmelek-relayer] bridge=hathor watching custody wmelek-bridge on mse-mainnet-melek ..."
```

The daemon resolves `MELEK_SIGNER_TOKEN`: if it points at a readable file (the tmpfs credential),
it reads the token from it; otherwise it treats the value as the token. Either way the token value
is never logged.

## First canary (after go-live) — a tiny real deposit

```
transfer:  to: wmelek-bridge   amount: 0.100 MELEK   memo: <a test engine account>
```

Within one tick (~30 s + `CONFIRMATIONS`) the relayer broadcasts `bridge.mintWrapped` and
`0.100 WMELEK` mints to the memo account on the engine. Verify against the engine read API:
`GET /balances?account=<recipient>&symbol=WMELEK` == `0.100`, and `bridge.lockedSupply` rises by
`0.100`. Then that account can `workerbee.foreverLock` the WMELEK → APIS-Hash → mine APIS.

## Ops

```bash
systemctl status melek-wmelek-relayer
tail -f /var/log/melek-wmelek-relayer.log
systemctl restart melek-wmelek-relayer      # after a code update: re-scp the .mjs, then restart
```

Config lives in the unit's `Environment=` lines. Idempotency is triple-guarded: the client seen-set,
the resumable `lastBlock` cursor, and `bridge.mintWrapped`'s own per-`depositRef` idempotence — a
restart or a double-broadcast can never double-mint.
