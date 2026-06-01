// collect-all.mjs — one pass that runs every read-bot and emits its data through the universal
// collector, so ALL of them feed the annals/briefs without editing each bot's internals. Operator
// 2026-06-01: get all the HIVE-Engine bots + the 20 new chain bots feeding data into the system.
// Read-only. Schedule this on a timer and every bot reports each run.
//
//   node integrations/collect-all.mjs            # one full collection pass
//   node integrations/collect-all.mjs hive        # just the HIVE-Engine bots
//   node integrations/collect-all.mjs chains      # just the 20-chain bots

import { emitBotData } from '../tools/bot-data.mjs';
import { market } from './hive-engine-market.mjs';
import { detectWalls } from './wall-bot.mjs';
import { holders } from './holders.mjs';
import { sellRisk } from './sell-risk.mjs';
import { CHAINS, chainStatus, chainsTvl, nativePrices } from './chains/multichain.mjs';
import { crossChainSpread } from './chains/crosschain-arb.mjs';

const HE_TOKENS = (process.env.COLLECT_HE_TOKENS || 'VKBT,CURE,SWAP.GIFU').split(',').map((s) => s.trim());
const XCHAIN_TOKENS = (process.env.COLLECT_XCHAIN || 'WETH,USDC,WBTC').split(',').map((s) => s.trim());

async function safe(label, fn) { try { return await fn(); } catch (e) { return { error: e.message, label }; } }

// --- HIVE-Engine bots ------------------------------------------------------
export async function collectHive() {
  for (const sym of HE_TOKENS) {
    const data = await safe(sym, async () => {
      const [metric, buyBook, sellBook, hold, risk] = await Promise.all([
        market.metrics(sym).catch(() => null),
        market.buyBook(sym, 50).catch(() => []),
        market.sellBook(sym, 50).catch(() => []),
        holders(sym).catch(() => []),
        sellRisk(sym).catch(() => null),
      ]);
      return {
        symbol: sym,
        lastPrice: +(metric?.lastPrice || 0), highestBid: +(metric?.highestBid || 0), lowestAsk: +(metric?.lowestAsk || 0), volume: +(metric?.volume || 0),
        buyWalls: detectWalls(buyBook).length, sellWalls: detectWalls(sellBook).length,
        holders: Array.isArray(hold) ? hold.length : 0,
        sellRisk: risk?.risk ?? risk?.score ?? null,
      };
    });
    emitBotData(`he-${sym.toLowerCase().replace(/\./g, '-')}`, { summary: `${sym} last=${data.lastPrice} bid=${data.highestBid} ask=${data.lowestAsk} walls=${data.buyWalls}/${data.sellWalls} holders=${data.holders}`, data });
  }
}

// --- 20-chain bots ---------------------------------------------------------
export async function collectChains() {
  const names = Object.keys(CHAINS);
  const [tvl, prices, statuses] = await Promise.all([
    chainsTvl().catch(() => ({})), nativePrices().catch(() => ({})), Promise.all(names.map((n) => chainStatus(n).catch(() => null))),
  ]);
  const rows = statuses.filter(Boolean).map((s) => ({ chain: s.chain, height: s.height, gasGwei: s.gasGwei, price: prices[CHAINS[s.chain]?.cg]?.usd ?? null, tvl: tvl[CHAINS[s.chain]?.llama] ?? null }));
  emitBotData('multichain', { summary: `${rows.length}/${names.length} chains read; up: ${rows.filter((r) => r.height || r.chain === 'cardano').length}`, data: { chains: rows } });

  for (const token of XCHAIN_TOKENS) {
    const r = await safe(token, () => crossChainSpread(token));
    emitBotData(`xchain-${token.toLowerCase()}`, { summary: `${token}: ${r.opportunity ? r.opportunity.spreadPct + '% spread' : 'no spread'} across ${r.venues?.length || 0} venues`, data: { token, venues: r.venues?.length || 0, opportunity: r.opportunity || null } });
  }
}

export async function collectAll() { await collectHive(); await collectChains(); }

if (process.argv[1] && process.argv[1].endsWith('collect-all.mjs')) {
  const which = process.argv[2];
  if (which === 'hive') await collectHive();
  else if (which === 'chains') await collectChains();
  else await collectAll();
  const { reportingBots } = await import('../tools/bot-data.mjs');
  console.log('collect-all done. Bots now reporting data:', reportingBots().join(', '));
}
