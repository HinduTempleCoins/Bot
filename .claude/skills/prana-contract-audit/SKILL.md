---
name: prana-contract-audit
description: Checklist-driven security audit of Solidity/EVM smart contracts on the PRANA compute chain (and any MELEK token/bridge/staking contracts). Use when asked to audit, review, find bugs in, or assess the safety of a .sol contract, or when work touches PRANA EVM contracts, the work-gate/redundant-recompute verifier, wrapped-asset bridges, or token issuance. NOT for the MELEK Graphene chain itself — that side uses only standard Graphene ops (comment/vote/transfer/delegate), no custom Solidity. Adapted (vetted, no injection) from farrellh1/smart-contract-auditor-skill + max-taylor/Claude-Solidity-Skills.
---

# PRANA / EVM Contract Security Audit

Drive a rigorous, checklist-anchored security review of Solidity/EVM contracts in the MELEK ecosystem. **Anchor every finding in a named checklist category** so reasoning is traceable to prior art — do not freestyle.

## MELEK scope boundaries (read first)

- **In scope:** PRANA (our core-geth/Ethash EVM chain, chainId 108369) smart contracts — the work-gate / redundant-recompute AI-work verifier, any wrapped-asset/bridge contracts, token issuance, staking, reward accounting, the MELEK-Engine side-token logic where it touches EVM.
- **Out of scope for THIS skill:** the MELEK Graphene chain (`hathor` witness, comment/vote/transfer/delegate). That chain stays standard Graphene — **no custom chain ops, no Solidity** — so a Solidity audit does not apply there. If asked to "audit the chain," clarify which side.
- **Zero-WIF, always:** this skill reads and reasons about code. It never requests, handles, logs, or stores a private key. No signing, no broadcasting, no key material in any output. (See the repo zero-WIF rule.)

## Why checklist-driven

Ad-hoc reviews miss bug classes the reviewer hasn't personally seen. The checklist encodes hundreds of real exploits by pattern — walking it beats intuition, especially in categories adjacent to a blind spot (a DeFi reviewer auditing a cross-chain bridge).

## Workflow

### 1. Scope the contract
Read the source first and answer, in 3–6 bullets back to the user:
- What does it do in one sentence? (verifier? bridge? token? staking? vault? reward distributor?)
- Which external systems does it touch? (oracles, routers, other PRANA contracts, an L1 bridge counterpart)
- Token standards in play? (ERC20 fee-on-transfer / rebasing? ERC721/1155? ERC4626?)
- Privileged roles + upgradeability pattern? One-step vs two-step ownership?
- Every `external`/`public` function — list them. Access-control gaps hide here.
- For a **redundant-recompute / work-gate** contract specifically: can a worker get paid without the recompute actually matching? Is the consensus/quorum threshold enforced on-chain or trusted off-chain? Can epochs be replayed or front-run?

### 2. Pick the relevant category floor
Always walk these:
- **Attacker's mindset** — reentrancy, DOS, front-running/MEV, donation, sandwich.
- **Basics** — access control, arithmetic/overflow, storage layout, initialization, uninitialized proxies.
- **Heuristics** — smell-level patterns worth a second look.

Load by scope match:
| Category | Trigger |
|---|---|
| DeFi | AMM, lending, vaults, yield, liquidations, oracle pricing, slippage |
| Token | custom ERC20/721/4626, fee-on-transfer, rebasing, transfer hooks |
| Integrations | Uniswap/Curve/Chainlink/LayerZero-style specifics |
| External-call | any low-level `call`, callbacks, router patterns |
| Signature | EIP-712, permit, meta-tx, off-chain signed orders/work-receipts |
| Hash/Merkle | airdrops, commit-reveal, allowlists, work-proof roots |
| Multi-chain/bridge | bridges, cross-chain messaging, same code on multiple chains |
| Low-level | inline assembly, raw storage, delegatecall |
| Centralization | admin powers, upgradeability, timelock absence |

For depth beyond this floor, fetch the live checklists rather than guessing: the SWC registry, Cyfrin `audit-checklist`, and Trail of Bits `building-secure-contracts` (links in `.local/SKILLS_RESEARCH_LINKS.md`). Run **Slither** and **Aderyn** as a static-analysis first pass and fold their findings in (cite the detector id).

### 3. Walk the checklist
For each item: quote the category/id, decide **applicable & OK** / **applicable & issue** / **not applicable (one-line reason)**. If an issue: point to `File.sol:line`, give the concrete exploit path, cite the category. Never skip silently — silent skips are how bugs hide.

### 4. Report
**Write the report to a markdown file, never dump it to the terminal.** Path: a user-specified path, else `<project-dir>/audit-report.md`, else `./audit-report.md`. Then print one line: `Report written to <path>`.

Structure: Scope → Checklist coverage (categories walked, items reviewed/NA counts) → Findings (each: Severity, Location, Impact, Exploit path, PoC for Critical/High, Recommendation with before/after snippet) → Informational table → Acknowledged non-issues → Open questions for the developer.

Severity: **Critical** = direct loss of funds, no preconditions. **High** = loss with realistic preconditions. **Medium** = griefing/temporary DOS/value leak. **Low** = code quality/unlikely edge. **Informational** = style/gas.

## Guardrails
- **Never invent a checklist id.** Cite real categories/detectors only; mark out-of-checklist findings as "outside checklist" rather than faking an id.
- **Never claim "no issues" after a partial walk** — state which categories you loaded.
- **Prefer concrete exploit paths.** "Front-runnable" is weak; "attacker observes tx in mempool, resubmits with higher gas causing X" is actionable.
- **Critical/High get a PoC + fix snippet** (Foundry-style test or numbered attack sequence). Don't wait to be asked.
- **The checklist is a floor, not a ceiling** — report anything you spot beyond it.
- **MELEK guardrail:** if the contract or review would require a key, signing, or a broadcast, STOP and flag it — route signing through MELEK-Signer, never inline.

## On a terse prompt ("audit this", "is this safe?")
Start immediately with scoping (Step 1), announce the categories you'll load, run Slither/Aderyn, then walk the checklist in the same response. Don't ask clarifying questions first — scoping extracts the essentials from the code. Always produce the full report.
