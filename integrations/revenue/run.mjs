// run.mjs — the driver + HUD. This is what the operator's cadence fires: it runs the pipeline (STAGED),
// ingests the real ledger, runs the accountability check on the result, records it, and surfaces it.
// The whole point is that a $0 window produces a loud, recorded, escalated answer — the AI cannot sleep
// on revenue because this runs on a timer and writes a demand every time realized ≤ 0.
//
//   node integrations/revenue/run.mjs once        # staged pipeline + accountability, prints the brief
//   node integrations/revenue/run.mjs report      # realized-revenue report (24h + 7d)
//   node integrations/revenue/run.mjs cadence      # the operating cadence definition
//
// handler(req,res): GET /api/revenue → JSON HUD (report + adapters + cadence + last accountability).
// Pure/injectable; soft-fail-never-throw; no keys; nothing broadcasts.

import * as ledger from './ledger.mjs';
import { runPipeline } from './pipeline.mjs';
import { adapterStatus } from './adapters.mjs';
import { loadProfitTracker } from './ingest.mjs';
import { METRIC, CADENCE, revenueReport, accountabilityCheck, renderBrief, recordAccountability } from './accountability.mjs';

/**
 * One cadence tick. Ingests real fills, runs the pipeline over `signals` (staged by default), scores
 * accountability against the resulting run, records it. Returns the full bundle.
 * Options: { signals, config, live, now, windowHours, ingest, persist }
 */
export async function once({
  signals = [],
  config = {},
  live = false,
  now = Date.now(),
  windowHours = 24,
  ingest = true,
  persist = true,
  hiveUsd = 1,
} = {}) {
  // 1. bring the real realized fills into the ledger so accountability reflects reality, not just staged.
  let ingested = { recorded: 0 };
  if (ingest) ingested = await loadProfitTracker({ ledger, hiveUsd }).catch(() => ({ recorded: 0 }));

  // 2. run the suggestion → execution pipeline (staged unless live + per-adapter auth).
  const run = await runPipeline({ signals, config, ledger, live, now });

  // 3. score accountability against THIS run (derived, un-fakeable "why").
  const record = accountabilityCheck({ ledger, run, now, windowHours, adapters: adapterStatus() });

  // 4. persist the accountability record (append-only, under .local/).
  let saved = { saved: false };
  if (persist) saved = await recordAccountability(record).catch(() => ({ saved: false }));

  return { ranAt: run.ranAt, ingested, run, accountability: record, brief: renderBrief(record), saved };
}

/** Realized-revenue report for the standard windows. */
export function report({ now = Date.now() } = {}) {
  return {
    metric: METRIC,
    day: revenueReport({ ledger, now, windowHours: 24 }),
    week: revenueReport({ ledger, now, windowHours: 168 }),
    adapters: adapterStatus(),
  };
}

// ── HTTP HUD ────────────────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  const method = (req && req.method) || 'GET';
  const path = ((req && req.url) || '/api/revenue').split('?')[0];
  const send = (code, obj) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    if (res && typeof res.end === 'function') res.end(JSON.stringify(obj));
    return obj;
  };
  if (method !== 'GET' || path !== '/api/revenue') return send(404, { error: 'not found', want: 'GET /api/revenue' });
  try {
    const now = Date.now();
    const rec = accountabilityCheck({ ledger, run: null, now, windowHours: 24, adapters: adapterStatus() });
    return send(200, {
      metric: METRIC, cadence: CADENCE,
      day: revenueReport({ ledger, now, windowHours: 24 }),
      week: revenueReport({ ledger, now, windowHours: 168 }),
      adapters: adapterStatus(),
      accountability: rec,
      generatedAt: new Date(now).toISOString(),
    });
  } catch (e) {
    return send(200, { error: e?.message || String(e), generatedAt: new Date().toISOString() });
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const cmd = process.argv[2] || 'once';
  if (cmd === 'cadence') {
    console.log(JSON.stringify({ metric: METRIC, cadence: CADENCE, adapters: adapterStatus() }, null, 2));
  } else if (cmd === 'report') {
    console.log(JSON.stringify(report(), null, 2));
  } else {
    // demo signals so `once` shows the loop end-to-end even with no live feed wired.
    const signals = [
      { id: 'sps-mom', symbol: 'SPS', side: 'sell', venue: 'hive-engine', edgePct: 5, price: 0.021, priceUsd: 0.021, depthUsd: 40, isRoundTrip: true, verdict: 'ACT' },
    ];
    const out = await once({ signals, config: { bankrollUsd: 100 } });
    console.log(out.brief);
    console.log('\n— run —');
    console.log(JSON.stringify(out.run, null, 2));
  }
}

export default { once, report, handler };
