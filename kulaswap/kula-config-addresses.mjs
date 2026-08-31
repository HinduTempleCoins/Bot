// kula-config-addresses.mjs — PRANA testnet contract addresses for the MELEK/KULA CDP DAG.
//
// Single source of truth for the on-chain addresses the off-chain CDP helpers reference. These are the
// PRANA testnet (chainId 108369) deployments as of 2026-06-16. Overridable via window.__KULA_ADDR__ so
// a host page / future mainnet can swap them without a rebuild. PUBLIC addresses only — no keys.
//
// The DAG: KULA → wMELEK → ALTI (one-way). Market 1 vault locks KULA / mints-from-reserve wMELEK;
// Market 2 vault locks wMELEK / MINTS ALTI (via the ALTI MINTER_ROLE). The Market-2 vault address is a
// PLACEHOLDER (zero) until the CDPVaultV2(wMELEK→ALTI) is deployed and the operator fills it in — the
// UI must treat a zero vault as "not yet live" and refuse to build a borrow tx against it.
//
// NET SWITCH (testnet ↔ mainnet): these are TESTNET addresses. Mainnet rollout is the SAME code on new
// servers with a mainnet config — see TESTNET_TO_MAINNET.md. The engine-side single switch is `NET`
// (testnet|mainnet) in engine/config.mjs (derives chain id / prefix / symbols / domains / the wMELEK
// bridge-only flag). On the front end, swap these addresses for the mainnet deploys via
// window.__KULA_ADDR__ (and the `prana` entry in kula-config.mjs via window.__KULA__) — no rebuild.
// wMELEK below is the PRANA WrappedEcosystemToken (tokenId keccak("MELEK")); on BOTH nets it is
// bridge-only mint/burn — its supply == MELEK locked in the GrapheneDepositBridge.

const ov = (typeof window !== 'undefined' && window.__KULA_ADDR__) || {};
const ovM = (typeof window !== 'undefined' && window.__KULA_ADDR_MAINNET__) || {};
const Z = '0x0000000000000000000000000000000000000000';

export const ADDR = Object.freeze({
  // Tokens
  KULA: '0x4c5859f0F772848b2D91F1D83E2Fe57935348029',
  wMELEK: '0x4C4a2f8c81640e47606d3fd77B353E87Ba015584', // WrappedEcosystemToken, tokenId keccak("MELEK")
  ALTI: '0xFD471836031dc5108809D173A067e8486B9047A3',   // NutBox "PNUTs" reward token (uncapped testnet)
  PoL: '0x5FbDB2315678afecb367f032d93F642f64180aa3',

  // Oracle the CDP vaults price collateral against
  oracle: '0x3Aa5ebB10DC797CAC828524e59A333d0A371443c', // SimplePriceOracle

  // NutBox delegation-mining (the ALTI minter today; the Market-2 vault will share ALTI's MINTER_ROLE)
  DelegationMint: '0x1429859428C0aBc9C2C47C8Ee9FBaf82cFA0F20f',

  // Bridge (Market 1 wMELEK source)
  GrapheneDepositBridge: '0x04C89607413713Ec9775E14b954286519d836FEf',

  // CDP vaults — Market 1 deployed elsewhere; Market 2 (wMELEK→ALTI) NOT yet deployed (zero = not live).
  marketAltiVault: ov.marketAltiVault || Z,

  ...ov,
});

// ── PRANA MAINNET (chainId 712217) — the LIVE CDP + veKULA deployment ─────────────────────────────────
// These are DEPLOYED and on-chain-verified (eth_getCode + wiring reads, 2026-08-31 via
// https://rpc.prana.melek.salon). The mainnet CDP is a SINGLE market and it IS the operator's stated
// model — "lock KULA → borrow mMELEK, 50% LTV" — NOT the old testnet KULA→wMELEK→ALTI DAG:
//   • cdpVault.collateral() == KULA, cdpVault.debtToken() == mMELEK, cdpVault.oracle() == oracle,
//     cdpVault.maxLTV() == 0.5e18, and the vault HOLDS MINTER_ROLE on mMELEK (the borrow gate is OPEN).
//   • mMELEK ("MELEK Borrow Note (KULA CDP)") is a DEDICATED CDP synthetic the vault mints/burns — it is
//     NOT wMELEK. wMELEK (0xf6d9…9AB9) stays bridge-only (supply ≡ MELEK locked in the bridge) and is
//     never minted by the CDP. This is the reconciliation of the DAG vs. the operator model.
//   • oracle is SimplePriceOracle (role-fed), price(KULA)=1e18 set; there is NO ChainlinkPriceAdapter
//     on mainnet. FEEDER_ROLE is held by the deployer EOA (manual price keeper — see the go-live doc).
//   • veKULA is VoteEscrow(token=KULA, maxLock=4y); Stake = lock KULA → boost + votes.
// Overridable via window.__KULA_ADDR_MAINNET__ for a host swap without a rebuild (mirrors ADDR/__KULA_ADDR__).
export const MAINNET_ADDR = Object.freeze({
  KULA:     '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631', // reward/DeFi token (emission-only, cap 11M)
  mMELEK:   '0x8c4B882D7379D35413E2a9202f63B53f893D1A9D', // MelekBorrowNote — the CDP debt synthetic
  wMELEK:   '0xf6d9BE2859191b45820Df3A3B3b321b1b2589AB9', // bridge asset (NOT the CDP debt token)
  oracle:   '0x905B3505037E49771B35F9f3944D8EC2B9eF3AFD', // SimplePriceOracle (CDP collateral price)
  cdpVault: '0x9cdAe72de19F93947cE3B4d5329FA81A5ef53ba2', // CDPVault: lock KULA → borrow mMELEK, 50% LTV
  veKULA:   '0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438', // VoteEscrow: lock KULA → boost + votes (4y max)
  DAOTimelock: '0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4', // admin of the emission-only tokens (2-day)
  ...ovM,
});

/** True only once the Market-2 (wMELEK→ALTI) vault has a real, non-zero address wired in (testnet DAG). */
export const altiMarketLive = () => !!ADDR.marketAltiVault && ADDR.marketAltiVault !== Z;

/** Mainnet CDP (Borrow) is live only when the vault address is real. The UI must refuse a borrow tx
 *  against a zero vault — same guard shape as altiMarketLive, applied to the mainnet single market. */
export const cdpMarketLive = () => !!MAINNET_ADDR.cdpVault && MAINNET_ADDR.cdpVault !== Z;

/** Mainnet Stake (veKULA) is live only when the VoteEscrow address is real. */
export const veLive = () => !!MAINNET_ADDR.veKULA && MAINNET_ADDR.veKULA !== Z;

/** Select the address block for a net: 'mainnet' → MAINNET_ADDR, anything else → the testnet ADDR. */
export const addrFor = (net) => (String(net).toLowerCase() === 'mainnet' ? MAINNET_ADDR : ADDR);
