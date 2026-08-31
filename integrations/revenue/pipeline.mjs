// pipeline.mjs — the SUGGESTION → EXECUTION pipeline. This is the machine the founder's grievance
// asked for: the bots' money-move suggestions no longer die on the vine. Each one flows
//
//     signal source → risk gate → execution adapter → confirmation → P&L record
//
// and EVERY suggestion's fate is recorded (staged / filled / rejected / failed) so nothing is quietly
// dropped. Default posture is STAGED — nothing broadcasts unless `live:true` AND the specific adapter's
// auth flag is set. That makes this genuinely ready without being able to move a cent on its own.
//
//   node integrations/revenue/pipeline.mjs         # demo run over sample signals (STAGED)
//
// Pure/injectable: pass `signals`, `adapters`, `ledger`, `config`. Soft-fail-never-throw.

import * as defaultLedger from './ledger.mjs';
import { gate as defaultGate, DEFAULT_GATE } from './risk-gate.mjs';
import { DEFAULT_ADAPTERS, pickAdapter } from './adapters.mjs';

const num = (x) => (Number.isFinite(+x) ? +x : NaN);

// Turn a gated candidate + its size into the concrete order the chosen adapter needs. Venue-specific
// fields are carried from the raw signal (mints for Solana, exchange for CEX, price for HE).
function buildOrder(candidate, sizeUsd) {
  const raw = candidate._raw || candidate;
  const priceUsd = num(candidate.priceUsd);
  const qty = Number.isFinite(priceUsd) && priceUsd > 0 ? sizeUsd / priceUsd : num(raw.qty);
  const base = { venue: candidate.venue, symbol: candidate.symbol, side: candidate.side,
    notionalUsd: sizeUsd, signalId: candidate.id, source: candidate.source, priceUsd };
  switch (candidate.venue) {
    case 'paybox-moonx':
      return { ...base, inputMint: raw.inputMint, outputMint: raw.outputMint,
        amount: raw.amount ?? sizeUsd, slippageBps: raw.slippageBps };
    case 'cex':
      return { ...base, exchange: raw.exchange, type: raw.type, qty: Number.isFinite(qty) ? qty : raw.qty,
        price: raw.price };
    case 'hive-engine':
    default:
      return { ...base, qty: Number.isFinite(qty) ? qty : raw.qty, price: raw.price ?? candidate.price };
  }
}

/**
 * Run the pipeline over a list of signals. Returns a full run report; records every outcome to the
 * ledger. Options:
 *   { signals, config, adapters, gate, ledger, live, now }
 * `live` defaults FALSE. Even live, each adapter re-checks its own auth flag, so this cannot broadcast
 * on a venue that has not been explicitly authorized.
 */
export async function runPipeline({
  signals = [],
  config = {},
  adapters = DEFAULT_ADAPTERS,
  gate = defaultGate,
  ledger = defaultLedger,
  live = false,
  now = Date.now(),
} = {}) {
  const cfg = { ...DEFAULT_GATE, ...config };
  const results = [];
  const rejectedByReason = {};
  let staged = 0, executed = 0, rejected = 0, failed = 0, unroutable = 0;

  for (const sig of Array.isArray(signals) ? signals : []) {
    let outcome;
    try {
      const g = gate(sig, cfg);
      if (!g.pass) {
        rejected += 1;
        rejectedByReason[g.reason] = (rejectedByReason[g.reason] || 0) + 1;
        ledger.record({ ts: now, venue: g.candidate?.venue, symbol: g.candidate?.symbol,
          side: g.candidate?.side, status: 'REJECTED', signalId: g.candidate?.id,
          reason: g.reason, source: g.candidate?.source });
        results.push({ signalId: g.candidate?.id, status: 'REJECTED', reason: g.reason });
        continue;
      }

      const order = buildOrder(g.candidate, g.sizeUsd);
      const adapter = pickAdapter(order, adapters);
      if (!adapter) {
        unroutable += 1;
        rejectedByReason['unroutable'] = (rejectedByReason['unroutable'] || 0) + 1;
        ledger.record({ ts: now, venue: order.venue, symbol: order.symbol, side: order.side,
          notionalUsd: order.notionalUsd, status: 'REJECTED', signalId: order.signalId,
          reason: 'unroutable (no adapter supports this order)', source: order.source });
        results.push({ signalId: order.signalId, status: 'REJECTED', reason: 'unroutable' });
        continue;
      }

      const conf = await adapter.execute(order, { live });
      const status = conf?.status === 'FILLED' ? 'FILLED' : conf?.status === 'FAILED' ? 'FAILED' : 'STAGED';
      if (status === 'FILLED') executed += 1;
      else if (status === 'FAILED') failed += 1;
      else staged += 1;

      ledger.record({ ts: now, venue: order.venue, symbol: order.symbol, side: order.side,
        qty: order.qty, priceUsd: order.priceUsd, notionalUsd: order.notionalUsd,
        status, signalId: order.signalId, reason: conf?.reason, source: order.source });
      outcome = { signalId: order.signalId, venue: order.venue, sizeUsd: g.sizeUsd, status,
        reason: conf?.reason, call: conf?.call || null };
      results.push(outcome);
    } catch (e) {
      failed += 1;
      ledger.record({ ts: now, status: 'FAILED', reason: e?.message || String(e), signalId: sig?.id });
      results.push({ signalId: sig?.id, status: 'FAILED', reason: e?.message || String(e) });
    }
  }

  const considered = Array.isArray(signals) ? signals.length : 0;
  return {
    ranAt: new Date(now).toISOString(),
    live,
    considered,
    counts: { staged, executed, rejected: rejected + unroutable, failed },
    rejectedByReason,
    results,
    note: live
      ? 'LIVE requested — but each adapter still enforces its own auth flag; only authorized venues broadcast.'
      : 'STAGED run — orders built and gated, nothing broadcast. Set live + per-adapter auth flags to execute.',
  };
}

// ── demo (STAGED) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('pipeline.mjs')) {
  const { reset } = defaultLedger;
  reset();
  const signals = [
    { id: 'a', symbol: 'SWAP.BTC', side: 'buy', venue: 'hive-engine', edgePct: 4, price: 60000, priceUsd: 60000, depthUsd: 50, verdict: 'ACT' },
    { id: 'b', symbol: 'SWAP.ETH', side: 'buy', venue: 'hive-engine', edgePct: 164, price: 3000, priceUsd: 3000, verdict: 'ACT' },   // dead-book
    { id: 'c', symbol: 'SPS', side: 'sell', venue: 'hive-engine', edgePct: 6, price: 0.02, priceUsd: 0.02, verdict: 'ACT' },          // naked sell
    { id: 'd', symbol: 'SOL/USDC', side: 'buy', venue: 'paybox-moonx', edgePct: 3, priceUsd: 1, depthUsd: 200,
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', outputMint: 'native', amount: 2, verdict: 'ACT' },
  ];
  const report = await runPipeline({ signals, config: { bankrollUsd: 100 } });
  console.log(JSON.stringify(report, null, 2));
}

export default { runPipeline };
