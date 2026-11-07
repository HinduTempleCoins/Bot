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
import { CHAINS, chainStatus, chainsTvl, nativePrices, missingPriceIds, PRANA_MAINNET_RPC, PRANA_RPC_ENV } from './chains/multichain.mjs';
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
        // holders() returns an OBJECT with the count at .counts.holders — it is not an array and has
        // never had a top-level .holders. `Array.isArray(hold) ? hold.length : 0` therefore wrote 0 on
        // every one of 56,884 rows for five months, so the holder-count series does not exist and
        // cannot be backfilled. Accumulation starts from this commit.
        holders: +(hold?.counts?.holders ?? 0),
        supply: +(hold?.supply ?? 0),
        realOutsidePct: hold?.realOutsidePct ?? null,
        // sellRisk() returns no .risk and no .score, so `risk?.risk ?? risk?.score ?? null` was null on
        // every row — while discarding the one field that answers "is the bid real": bidSupportUsd, the
        // summed price*quantity of the whole buy book. Five months of depth data thrown away at write
        // time, which is why bid-side capital is not reconstructible from the archive.
        bidSupportUsd: risk?.bidSupportUsd ?? null,
      };
    });
    emitBotData(`he-${sym.toLowerCase().replace(/\./g, '-')}`, { summary: `${sym} last=${data.lastPrice} bid=${data.highestBid} ask=${data.lowestAsk} walls=${data.buyWalls}/${data.sellWalls} holders=${data.holders} bidSupport=$${data.bidSupportUsd ?? '?'}`, data });
  }
}

// --- 20-chain bots ---------------------------------------------------------
export async function collectChains() {
  // THIS collector wants our own chain read even with no EnvironmentFile on its unit — which is
  // exactly the state melek-collect.service is in, and why `prana` was the one chain of 23 that
  // reported nothing for five months. The default lives here rather than in pranaRpc() so that
  // every other reader keeps its dormant-when-unset contract and the test suite stays offline.
  if (!process.env[PRANA_RPC_ENV]) process.env[PRANA_RPC_ENV] = PRANA_MAINNET_RPC;
  const names = Object.keys(CHAINS);
  const [tvl, prices, statuses] = await Promise.all([
    chainsTvl().catch(() => ({})), nativePrices().catch(() => ({})), Promise.all(names.map((n) => chainStatus(n).catch(() => null))),
  ]);
  // chainStatus() returns an `error` on failure and this mapping used to drop it, so a chain that
  // was failing looked exactly like a chain that was quiet: height simply came out null. `sui` has
  // been null for 64% of five months and nothing recorded why. Carry the error through.
  const rows = statuses.filter(Boolean).map((s) => ({ chain: s.chain, height: s.height, gasGwei: s.gasGwei, price: prices[CHAINS[s.chain]?.cg]?.usd ?? null, tvl: tvl[CHAINS[s.chain]?.llama] ?? null, error: s.error ?? null }));
  const errored = rows.filter((r) => r.error).map((r) => r.chain);
  // A retired or mistyped CoinGecko id is INVISIBLE in the rows above: the chain just carries
  // `price: null`, indistinguishable from a transient upstream miss. `polygon` sat on the pre-migration
  // `matic-network` id and reported a price frozen at 0.126156 for 158 days without anyone noticing.
  // Recording which ids we asked for and did not get turns a silent five-month failure into a visible
  // one on the next run. See missingPriceIds() for why a chain with no `cg` is not counted.
  const priceGaps = missingPriceIds(prices);
  emitBotData('multichain', { summary: `${rows.length}/${names.length} chains read; up: ${rows.filter((r) => r.height != null).length}`
    + (errored.length ? `; ERRORED: ${errored.join(', ')}` : '')
    + (priceGaps.length ? `; NO PRICE for id(s): ${priceGaps.join(', ')}` : ''), data: { chains: rows, priceGaps, errored } });

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
