# PRANA mainnet — KULA Arcade deploy (prepared, ready-to-run)

`deploy-arcade.js` deploys the compliant **play-token** arcade set to PRANA and records the addresses to
`contracts/deployments-arcade.json`:

- **PlayToken** — non-cashable arcade credit (no user↔user / user→DEX transfer path; no cash-out).
- **ArcadeSpin** — free daily wheel (mints free PLAY).
- **KulaLotto** — commit-reveal raffle (PLAY tickets, provably-fair draw).
- **BinaryEventMarket** — Yes/No parimutuel (PLAY stakes, named-source resolution + dispute window).

It mirrors the testnet deploy proven end-to-end (chainId 108369) against **mainnet chainId 712217**.

## This is prepared, not run
The mainnet deployer key is shared with the DeFi-core deploy; concurrent txs collide on nonces. The parent
serializes the run. This directory is the committed copy for the record — the runnable copy lives in the
PRANA contracts repo at `contracts/scripts/deploy-arcade.js` (needs the compiled artifacts / hardhat).

## Run (in the PRANA contracts repo, after the core deploy)
```
PRANA_DEPLOYER_KEY=<deployer key>       # supplied JIT; never committed
PRANA_MAINNET_RPC=<mainnet rpc url>
ARCADE_TREASURY=<non-zero PLAY fee/burn sink = the genesis feeAddress>
  npx hardhat run scripts/deploy-arcade.js --network prana_mainnet
```
Optional overrides: `ARCADE_ADMIN` (default deployer), `ARCADE_SPIN_NAMES/WEIGHTS/PAYOUTS` (default =
testnet-proven `No win/1/5/Jackpot 50`, weights `50,30,15,5`, payouts `0,1e18,5e18,50e18`).

The script deploys the four contracts, wires `MINTER_ROLE` (spin) + the arcade endpoint allow-list
(non-cashable enforcement), writes `deployments-arcade.json`, and prints the service env block.

## Point the surfaces at mainnet
The arcade surfaces already read the canonical net (`integrations/chains/prana-network.mjs`, chainId
712217). After deploy, set per service and restart:
```
PRANA_NET=mainnet
ARCADE_LOTTO_ADDR=<KulaLotto>
ARCADE_MARKET_ADDR=<BinaryEventMarket>
```
`PRANA_NET=mainnet` also flips every surface's framing from "testnet" to "mainnet" (via `NET_LABEL` in
`site/arcade/shared.mjs`).

## Post-deploy (via MELEK-Signer, not the deploy script)
Grant `PlayToken` MINTER_ROLE to the earn attesters; grant the keeper KulaLotto DRAW_ROLE +
BinaryEventMarket roles; provision the keeper's OAuth bearer + gas to arm autonomous writes. Until then the
keeper runs `--dry` (plan-only, never broadcasts blind).

Full runbook (hosts, exact treasury address, verify steps) is operator-private in
`.local/PRANA_MAINNET_ARCADE_DEPLOY.md`.
