# MELEK → PRANA Bridge Relayer Runbook

The relayer is the off-chain service that automates the proven on-chain mint. A user deposits
native MELEK to the bridge **custody account**; each attester relayer sees the deposit, waits
for finality, and calls `GrapheneDepositBridge.attestDeposit(...)` on PRANA. Once the
threshold of distinct attesters agrees, the contract mints **wMELEK** to the recipient.

- **Trust model:** 2-of-3 distinct attester keys (federated K-of-N).
- **One relayer instance = one attester key.** Run **K instances** (here, all 3) so the
  2-of-3 threshold is always reachable even if one instance is down.
- **The relayer signs nothing in this repo.** `bridge-relayer-runner.mjs` builds the *unsigned*
  `attestDeposit` call descriptor and hands it to an injected `submit(call, deposit)` function.
  The signing/sending edge (ethers wallet using that instance's attester key + the public PRANA
  RPC) lives outside this module — see "The submit edge" below.

## Contract / chain facts

| Thing | Value |
|---|---|
| `GrapheneDepositBridge` (PRANA) | `0x04C89607413713Ec9775E14b954286519d836FEf` |
| `wMELEK` (PRANA) | `0x4C4a2f8c81640e47606d3fd77B353E87Ba015584` |
| tokenId | `keccak256("MELEK")` |
| MELEK native decimals → wrapper decimals | 3 → 18 (scaled by the relayer) |
| Attest method | `attestDeposit(bytes32 depositRef, bytes32 tokenId, address recipient, uint256 amount)` |
| `depositRef` | the MELEK transaction id (globally unique; the on-chain replay key) |

## Deposit memo format (what the USER does)

The user transfers native MELEK to the custody account and **puts their PRANA `0x` address in
the transfer memo**. The relayer reads the destination ONLY from the signed MELEK op — it can
never redirect funds.

```
transfer  to: <custody account>   amount: 1.234 MELEK   memo: 0xRecipientPranaAddress
```

- Minimum viable memo: a single `0x…` (40 hex) address.
- Optional explicit token pin: `0xRecipient TOKEN=<tokenId>` — use this to pin the exact
  `bytes32` tokenId the contract expects (`keccak256("MELEK")`). Without `TOKEN=`, the relayer
  derives the tokenId from the transfer's asset symbol (`MELEK`); set `BRIDGE_TOKEN_ID` and/or
  have users send the `TOKEN=` form so the on-chain `bytes32` matches exactly.
- A `custom_json` deposit op is also supported (`{ dst|to|recipient, token|tokenId, amount }`).
- A transfer with no parseable `0x` address in the memo is **skipped** (never attested).

## Env each instance needs

Every instance shares the read/target config and differs only by its **own attester key**:

| Var | Shared? | Meaning |
|---|---|---|
| `MELEK_RPC_URL` | shared | MELEK Graphene JSON-RPC the relayer reads custody history from |
| `PRANA_RPC_URL` | shared | public PRANA RPC the submit edge broadcasts to |
| `GRAPHENE_BRIDGE_ADDRESS` | shared | `0x04C89607413713Ec9775E14b954286519d836FEf` |
| `MELEK_BRIDGE_CUSTODY` | shared | the MELEK account users deposit to |
| `BRIDGE_TOKEN_ID` | shared | `keccak256("MELEK")` (so transfers without `TOKEN=` still attest the right id) |
| `CONFIRMATIONS` | shared | finality depth before attesting (default 20) |
| `BRIDGE_HISTORY_LIMIT` | shared (optional) | how many recent custody history rows to scan per pass (default 200, max 1000) |
| `PRANA_ATTESTER_KEY` | **PER INSTANCE** | THIS instance's attester private key. **Never** logged, never committed, never the same across two instances. |

`PRANA_ATTESTER_KEY` is read only at the submit edge; the runner core never reads it (the
config object carries a `keyPresent` boolean only — the value never appears in any manifest
or log).

## Running 3 instances (2-of-3)

Each instance is the same code with a different `PRANA_ATTESTER_KEY` (and ideally a different
host / process). Shared config identical across all three.

```
# instance 1
MELEK_RPC_URL=… PRANA_RPC_URL=… GRAPHENE_BRIDGE_ADDRESS=0x04C8…6FEf \
MELEK_BRIDGE_CUSTODY=<custody> BRIDGE_TOKEN_ID=<keccak256(MELEK)> CONFIRMATIONS=20 \
PRANA_ATTESTER_KEY=<key #1>   node <your-daemon-entry>.mjs

# instance 2 — same, PRANA_ATTESTER_KEY=<key #2>
# instance 3 — same, PRANA_ATTESTER_KEY=<key #3>
```

Each runs `makeRunner(submit, loadConfig()).tick()` on a timer (e.g. every 30–60s). The
per-process seen-set makes a `depositRef` submit at most once per process; the contract's
`AlreadyAttested` revert is the on-chain backstop. A submit failure leaves the ref **unseen**
so the next tick retries.

## The submit edge (production wiring, kept OUT of this module)

`bridge-relayer-runner.mjs` is pure orchestration + an injected `submit`. The production
`submit` is the only place ethers/keys appear:

```js
import { makeRunner, loadConfig } from './bridge-relayer-runner.mjs';
import { ethers } from 'ethers';

const cfg = loadConfig();
const provider = new ethers.JsonRpcProvider(cfg.pranaRpc);
const wallet   = new ethers.Wallet(process.env.PRANA_ATTESTER_KEY, provider); // edge only
const bridge   = new ethers.Contract(cfg.bridgeAddress, ABI, wallet);

const submit = (call) => bridge[call.method](...call.args); // call.args = [ref,tokenId,recipient,amount]
const runner = makeRunner(submit, cfg);
setInterval(() => runner.tick().then(r => log(r)), 45_000);
```

## Loop behavior (per tick)

1. Read `condenser_api.get_dynamic_global_properties` (head = last irreversible block) and
   `condenser_api.get_account_history` for the custody account (injectable fetch).
2. `scanDeposits` → derive attestable deposits (custody-bound, recipient from the signed memo,
   amount scaled 3→18dp, `depositRef` = tx id).
3. Drop deposits below the `CONFIRMATIONS` finality depth → `pending`.
4. Drop refs already submitted by this instance → `skipped` (idempotent).
5. For each remaining: `submit(attestationCall(deposit))`; on success mark seen; on throw record
   in `failed` and leave unseen for retry. The loop never throws.

## Safety notes

- Never log or echo `PRANA_ATTESTER_KEY`. The pre-commit hook blocks key material in public
  commits; keep keys in the host env / vault only.
- Destination is taken ONLY from the signed MELEK op — the relayer cannot choose a recipient.
- Finality (`CONFIRMATIONS`) protects against reorg double-mints; do not set it to 0.
