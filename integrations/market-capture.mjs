// market-capture.mjs — high-frequency market snapshotter for capturing a live EVENT (e.g. a price
// spike) and its effect on the book. Read-only. Snapshots price + best bid/ask + walls + recent
// fills every INTERVAL for DURATION, records each to a jsonl + emits via the bot-data collector so
// the spike and its aftermath land in the annals/briefs.
//
//   node integrations/market-capture.mjs VKBT --interval 8 --duration 360
//   import { snapshot } from './market-capture.mjs'

import { market } from './hive-engine-market.mjs';
import { detectWalls } from './wall-bot.mjs';
import { emitBotData } from '../tools/bot-data.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

// one read-only snapshot of a token's market state.
export async function snapshot(symbol) {
  const [metric, buyBook, sellBook, fills] = await Promise.all([
    market.metrics(symbol).catch(() => null),
    market.buyBook(symbol, 50).catch(() => []),
    market.sellBook(symbol, 50).catch(() => []),
    (market.tradesHistory ? market.tradesHistory(symbol, 10) : Promise.resolve([])).catch(() => []),
  ]);
  return {
    at: new Date().toISOString(), symbol,
    lastPrice: +(metric?.lastPrice || 0),
    highestBid: +(metric?.highestBid || (buyBook[0]?.price || 0)),
    lowestAsk: +(metric?.lowestAsk || (sellBook[0]?.price || 0)),
    volume: +(metric?.volume || 0),
    buyDepth: buyBook.reduce((s, o) => s + +o.quantity, 0),
    sellDepth: sellBook.reduce((s, o) => s + +o.quantity, 0),
    buyWalls: detectWalls(buyBook, { minMultiple: 3 }).slice(0, 3),
    sellWalls: detectWalls(sellBook, { minMultiple: 3 }).slice(0, 3),
    recentFills: (Array.isArray(fills) ? fills : []).slice(0, 5).map((f) => ({ price: +f.price, qty: +f.quantity, type: f.type })),
  };
}

async function captureLoop(symbol, { interval, duration }) {
  const path = `.local/market-capture-${symbol}.jsonl`;
  mkdirSync('.local', { recursive: true });
  const end = Date.now() + duration * 1000;
  const snaps = [];
  while (Date.now() < end) {
    const s = await snapshot(symbol).catch((e) => ({ at: new Date().toISOString(), symbol, error: e.message }));
    snaps.push(s);
    const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
    writeFileSync(path, prior + JSON.stringify(s) + '\n');
    process.stdout.write(`  ${s.at?.slice(11, 19)} ${symbol} last=${s.lastPrice} bid=${s.highestBid} ask=${s.lowestAsk} vol=${s.volume}\n`);
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
  // summarise the move: first vs last, peak
  const valid = snaps.filter((s) => s.lastPrice > 0);
  const first = valid[0], last = valid[valid.length - 1];
  const peak = valid.reduce((m, s) => (s.lastPrice > m ? s.lastPrice : m), 0);
  const summary = first && last
    ? `${symbol} capture: ${valid.length} snaps, last ${first.lastPrice}->${last.lastPrice} (peak ${peak}), ${(((last.lastPrice - first.lastPrice) / first.lastPrice) * 100).toFixed(1)}%`
    : `${symbol} capture: ${snaps.length} snaps`;
  emitBotData('market-capture', { summary, data: { symbol, snaps: snaps.length, first, last, peak } });
  return { summary, snaps };
}

if (process.argv[1] && process.argv[1].endsWith('market-capture.mjs')) {
  const symbol = (process.argv[2] || 'VKBT').toUpperCase();
  const interval = +(process.argv[process.argv.indexOf('--interval') + 1] || 8);
  const duration = +(process.argv[process.argv.indexOf('--duration') + 1] || 300);
  console.log(`[market-capture] ${symbol} every ${interval}s for ${duration}s — recording the spike + aftermath`);
  const { summary } = await captureLoop(symbol, { interval, duration });
  console.log(`\n${summary}\n→ .local/market-capture-${symbol}.jsonl + annals feed`);
}
