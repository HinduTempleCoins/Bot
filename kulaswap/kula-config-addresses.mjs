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

/** True only once the Market-2 (wMELEK→ALTI) vault has a real, non-zero address wired in. */
export const altiMarketLive = () => !!ADDR.marketAltiVault && ADDR.marketAltiVault !== Z;
