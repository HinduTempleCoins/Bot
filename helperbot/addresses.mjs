// addresses.mjs — PUBLIC PRANA-mainnet (chainId 712217) contract addresses the helper bot reads.
// KULA / veKULA / wMELEK / CDP come from the canonical kulaswap config (single source of truth); the
// rest are the deploy-record-verified addresses published in PRANA_PAPER.md / KULA_PAPER.md §7.
// Addresses are protocol wiring (they don't change); every NUMBER is read live at call time.
// AMM pair addresses are NOT listed: they are resolved live from the factory (getPair).

import { MAINNET_ADDR } from '../kulaswap/kula-config-addresses.mjs';

export const PRANA_CHAIN_ID = 712217;
export const PRANA_ALPHA_CHAIN_ID = 108369;

export const PRANA = Object.freeze({
  KULA: MAINNET_ADDR.KULA,
  veKULA: MAINNET_ADDR.veKULA,
  wMELEK: MAINNET_ADDR.wMELEK,
  mMELEK: MAINNET_ADDR.mMELEK,
  cdpVault: MAINNET_ADDR.cdpVault,
  DAOTimelock: MAINNET_ADDR.DAOTimelock,
  WPRANA: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34',
  factory: '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6',
  router: '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5',
  wVKBT: '0xD915E757662c4234137aff167Bf93d588145f75e',
  wCURE: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff',
  bridge: '0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505',
  hathorFeeTreasury: '0xF129608bF3BA681012CF82DFfCfBB92563df987e',
  emissionScheduler: '0x611Ad02Ebe7F3FfE2050449Def20d6775E875323',
  gaugeController: '0x3858Bcd8CEE92FBDB0ECBC3946C67C112416A63C',
});

export const DECIMALS = Object.freeze({ KULA: 18, WPRANA: 18, wMELEK: 18, wVKBT: 8, wCURE: 8 });

export const LINKS = Object.freeze({
  kulaswap: 'https://kula.money/',
  bridge: 'https://kula.money/bridge.html',
  pranascan: 'https://pranascan.soapbox.community',
  pranaDev: 'https://witness.melek.salon/dev/prana',
  melekWallet: 'https://wallet.melek.salon/',
  melekExplorer: 'https://melekd.hathor.live/',
  engine: 'https://engine.melek.salon/',
  hiveEngine: (sym) => `https://tribaldex.com/trade/${sym}`,
  map: 'https://melek.salon/map/',
  // Discord invite supplied by the operator 2026-10-17 — EXPIRES 2026-11-14; replace with a permanent one.
  discord: process.env.HELPERBOT_DISCORD_INVITE || 'https://discord.gg/6pyjAv2Qu',
});
