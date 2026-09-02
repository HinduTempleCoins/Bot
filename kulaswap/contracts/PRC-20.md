# PRC-20: The PRANA Token Standard

**Status:** Final · **Type:** Standards Track (Token) · **Requires:** none · **Chain:** PRANA (mainnet chainId 712217)

## Abstract

PRC-20 is the fungible-token standard for the PRANA chain. It is **ERC-20, verbatim** — the same function
interface, the same `Transfer`/`Approval` events, the same semantics — so that a PRC-20 token *is* an ERC-20
token to every wallet, DEX, explorer, and indexer that already exists. KulaSwap, MetaMask, and PRANA's
Blockscout need **zero special handling** for a PRC-20 token. The standard exists to give PRANA's tokens
(KULA, MWALI, SOULAVA, and any future token) one documented, conformant shape.

## Motivation

PRANA is an EVM chain. Reusing ERC-20 unchanged — rather than inventing a novel interface — is the whole
point: it inherits the entire tooling ecosystem for free. "PRC-20" names and documents that choice so token
issuers have a canonical spec and a reference implementation to conform to, and so consumers can rely on it.

## Specification

A conforming PRC-20 token **MUST** implement the ERC-20 core exactly:

```solidity
function name() external view returns (string);         // OPTIONAL metadata (RECOMMENDED)
function symbol() external view returns (string);        // OPTIONAL metadata (RECOMMENDED)
function decimals() external view returns (uint8);       // OPTIONAL metadata (RECOMMENDED); default 18
function totalSupply() external view returns (uint256);
function balanceOf(address owner) external view returns (uint256);
function transfer(address to, uint256 value) external returns (bool);
function transferFrom(address from, address to, uint256 value) external returns (bool);
function approve(address spender, uint256 value) external returns (bool);
function allowance(address owner, address spender) external view returns (uint256);

event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);
```

Required semantics:

1. **Exact-amount transfers.** `transfer`/`transferFrom` MUST move the exact `value`. Fee-on-transfer and
   rebasing tokens are **NOT** PRC-20 (they break DEX accounting).
2. **Zero-address guard.** Transfers to `address(0)` MUST revert (use `burn`, not a transfer, to destroy).
3. **Insufficient funds revert.** A transfer exceeding balance, or a `transferFrom` exceeding allowance,
   MUST revert (not return `false` silently).
4. **Events.** `Transfer` MUST be emitted on every transfer, mint (from `address(0)`), and burn (to
   `address(0)`); `Approval` on every `approve`.
5. **Decimals.** `decimals` SHOULD be `18` unless there is a specific reason otherwise.
6. **Infinite allowance.** An allowance of `type(uint256).max` SHOULD NOT be decremented on `transferFrom`.

### Extensions (OPTIONAL — a token MAY add these and remain PRC-20)

- **Mintable (`MINTER_ROLE`).** `mint(address to, uint256 amount)`, gated to holders of `MINTER_ROLE`. This is
  how emission tokens are created at claim time (e.g. MWALI's gauge, SOULAVA's delegation distributor hold
  `MINTER_ROLE`). Minting emits `Transfer(address(0), to, amount)`.
- **Capped.** An immutable `cap` (0 == uncapped); `mint` MUST revert past the cap.
- **Burnable.** `burn(uint256 amount)` destroys the caller's tokens; emits `Transfer(msg.sender, address(0), amount)`.
- **AccessControl.** `grantRole`/`revokeRole`/`hasRole` with a `DEFAULT_ADMIN_ROLE`, for role administration.

## Reference implementation

[`src/PRC20.sol`](./src/PRC20.sol) — a self-contained (dependency-free), audit-friendly ERC-20 with the
optional mint/cap/burn/role extensions. Behavior is identical to a canonical OpenZeppelin `ERC20` +
`AccessControl` + `ERC20Capped`. Issuers MAY use it directly, or use OpenZeppelin and conform to the spec.

## PRANA tokens under this standard

| Token | Role | Mint path |
|---|---|---|
| **KULA** | DeFi/reward token (cap 11M) | emission-only |
| **MWALI** | Proof-of-Liquidity reward | minted by `MwaliPoLGauge` (`MINTER_ROLE`) |
| **SOULAVA** (SOULA) | delegation-mining reward | minted by the delegation distributor (`MINTER_ROLE`), from off-chain MELEK-delegation accounting |
| **mMELEK** | KULA-CDP synthetic | minted/burned by the CDP vault |

## Rationale

Every deviation from ERC-20 costs tooling compatibility. PRC-20 deviates in nothing at the interface level;
it only *documents* the canonical shape and its optional extensions. The name asserts PRANA's identity
without fragmenting the standard.

## Security considerations

- Grant `MINTER_ROLE` only to audited emitter contracts (gauges, distributors, CDP vaults) or a timelock —
  never a hot EOA in production. Revoking a compromised minter is a `revokeRole` from the admin/timelock.
- The zero-address and exact-amount guards above are load-bearing for DEX safety; do not relax them.
