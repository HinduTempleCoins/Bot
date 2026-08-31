// accountability.mjs — the loop the AI runs ON ITSELF so it cannot quietly "sleep" on revenue.
//
// The grievance: "You need to be making Money … And You just Sleep and act like it's not a Problem."
// Since January: $0. This module makes $0 IMPOSSIBLE TO IGNORE. On every cadence tick it:
//   1. measures REALIZED dollars in the window (FILLED rows only, via the audited pnl-metric),
//   2. if that is ≤ 0, raises a REQUIRED accountability record that CANNOT be empty — its `why` is
//      DERIVED from the actual pipeline census (how many suggestions were considered, how many are
//      STAGED awaiting authorization, and the exact histogram of rejection reasons), so the answer to
//      "why did we make no money?" is a fact from the ledger, not a story,
//   3. states the next ACTION and whether it must ESCALATE to the operator.
//
// This is the anti-theater device: "the bots suggested things and I polished infra" reads here as a
// concrete, falsifiable line — e.g. "18 considered · 5 STAGED (live execution NOT authorized:
// REVENUE_LIVE unset) · 13 rejected (9 below-min-edge, 4 dead-book)". That either points at a real
// blocker the operator must clear, or at the AI having done nothing — and both are visible.
//
// Pure/injectable, soft-fail-never-throw. Records to a JSONL under .local/ (never committed).

import * as defaultLedger from './ledger.mjs';
import { adapterStatus } from './adapters.mjs';

const HOUR = 3600e3, DAY = 24 * HOUR;
const round = (x, d = 2) => (Number.isFinite(+x) ? +(+x).toFixed(d) : 0);

// ── the metric + its cadence (the operator asked for both, explicitly) ─────────────────────────────
export const METRIC = Object.freeze({
  name: 'realizedNetUsd',
  definition: 'Σ round-trip P&L in USD, FIFO-matched, net of fees, naked sells excluded, over the window.',
  source: 'integrations/revenue/ledger.mjs → realizedScorecard() → pnl-metric.scorecard().netPnl (FILLED rows only)',
  healthy: '> 0 for the day AND the running week; a period with 0 FILLED trades is a flag, not a pass.',
});

export const CADENCE = Object.freeze({
  daily: { windowHours: 24, purpose: 'Did we realize a dollar today? If 0 → forced accountability record + operator escalation.' },
  weekly: { windowHours: 168, purpose: 'Rolling 7-day realized P&L and scorecard trend; the "since January = $0" backstop.' },
  perTick: { everyMinutes: 60, purpose: 'Run the pipeline (staged), refresh the census, so the daily check has live inputs.' },
  recordedAt: '.local/revenue/accountability.jsonl (append-only) + surfaced in the hourly FOR-RYAN brief and GET /api/revenue.',
});

/** Realized-revenue report over a window. Always an object. */
export function revenueReport({ ledger = defaultLedger, now = Date.now(), windowHours = 24, benchmarkPnl = 0 } = {}) {
  const since = now - windowHours * HOUR;
  const scorecard = ledger.realizedScorecard({ since, benchmarkPnl });
  const census = ledger.census({ since });
  return {
    windowHours,
    since: new Date(since).toISOString(),
    now: new Date(now).toISOString(),
    realizedNetUsd: round(scorecard.netPnl),
    dumpUsd: round(scorecard.dumpPnl),
    roundTrips: scorecard.roundTrips,
    profitable: scorecard.profitable,
    scorecard,
    census,
  };
}

// Build the DERIVED "why" from a pipeline run + adapter authorization state. This is what makes the
// record un-fakeable: the reasons come straight off the run, not from prose.
function deriveWhy({ run, adapters }) {
  const why = [];
  const auth = (adapters || adapterStatus());
  const unauthorized = auth.filter((a) => !a.authorized);
  if (!run || !run.considered) {
    why.push('0 suggestions reached the pipeline this window — no signal source produced a candidate (check the bots / signal-orchestrator feed).');
    return { why, unauthorizedVenues: unauthorized.map((a) => a.venue) };
  }
  const c = run.counts || {};
  if (c.executed > 0) why.push(`${c.executed} order(s) FILLED but realized P&L is still ≤ 0 — winners are not yet clearing fees/losers (inspect the scorecard: hitRate / winLossRatio).`);
  if (c.staged > 0) {
    const gates = unauthorized.map((a) => a.authGate).join(', ') || 'per-adapter auth flags';
    why.push(`${c.staged} order(s) STAGED and READY but NOT broadcast — live execution is not authorized (${gates} unset). This is the operator gate, not a code gap.`);
  }
  if (c.rejected > 0) {
    const hist = Object.entries(run.rejectedByReason || {}).sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${n}×${r}`).join(', ');
    why.push(`${c.rejected} suggestion(s) rejected by the risk gate (${hist}) — either genuinely no edge, or thresholds too tight.`);
  }
  if (c.failed > 0) why.push(`${c.failed} adapter failure(s) — see ledger FAILED rows.`);
  return { why, unauthorizedVenues: unauthorized.map((a) => a.venue) };
}

/**
 * The accountability check. Returns a record that is ALWAYS actionable. `status`:
 *   'OK'           — realized > 0 this window.
 *   'ZERO_REVENUE' — realized ≤ 0; carries derived `why`, `actions`, and escalate:true.
 * `run` is the latest pipeline run report (for the derived why). `adapters` optional override.
 */
export function accountabilityCheck({
  ledger = defaultLedger, run = null, now = Date.now(), windowHours = 24,
  adapters = null, target = 0,
} = {}) {
  const report = revenueReport({ ledger, now, windowHours });
  const realized = report.realizedNetUsd;
  const base = {
    checkedAt: new Date(now).toISOString(),
    metric: METRIC.name,
    windowHours,
    realizedNetUsd: realized,
    target,
    census: report.census,
  };

  if (realized > target) {
    return { ...base, status: 'OK', escalate: false,
      note: `Realized $${realized} (> target $${target}) in the last ${windowHours}h. Keep the round-trips closing.` };
  }

  const { why, unauthorizedVenues } = deriveWhy({ run, adapters });
  const actions = [];
  const staged = run?.counts?.staged || 0;
  if (staged > 0 && unauthorizedVenues.length) {
    actions.push(`ESCALATE: ${staged} gated order(s) are ready to execute on ${unauthorizedVenues.join(', ')} — request operator authorization (set the adapter auth flag) to turn suggestion into realized P&L.`);
  }
  if (!run || !run.considered) {
    actions.push('Fix the signal supply: confirm the bots + signal-orchestrator are producing candidates; a dry pipeline means no revenue is even possible.');
  }
  if ((run?.counts?.rejected || 0) > 0 && staged === 0) {
    actions.push('Every suggestion was rejected: re-examine gate thresholds (minEdgePct / dust floor) vs current book conditions, or accept that there is genuinely no +EV edge right now and say so.');
  }
  if ((run?.counts?.executed || 0) > 0) {
    actions.push('Orders filled but no realized profit: audit fills for buy-first discipline and fee drag; a fill that only dumps inventory is not revenue.');
  }
  if (!actions.length) actions.push('No suggestions, no fills, no rejections this window — the pipeline did not run. Run it and re-check.');

  return {
    ...base,
    status: 'ZERO_REVENUE',
    escalate: true,
    why,
    actions,
    demand: `$0 realized in the last ${windowHours}h. This is the failure being tracked. State the blocker (above) and the next action — do not let this pass silently.`,
  };
}

/** Render a record as the plain-text block for the FOR-RYAN brief (front-end friendly). */
export function renderBrief(rec = {}) {
  if (!rec || !rec.status) return 'REVENUE ACCOUNTABILITY — no record.';
  const L = [];
  L.push(`REVENUE ACCOUNTABILITY — ${rec.status} — realized $${round(rec.realizedNetUsd)} in last ${rec.windowHours}h`);
  if (rec.status === 'OK') { L.push(`  ${rec.note}`); return L.join('\n'); }
  L.push(`  DEMAND: ${rec.demand}`);
  if (rec.why?.length) { L.push('  WHY (from the ledger, not a story):'); for (const w of rec.why) L.push(`    • ${w}`); }
  if (rec.actions?.length) { L.push('  NEXT:'); for (const a of rec.actions) L.push(`    → ${a}`); }
  if (rec.escalate) L.push('  ⇒ ESCALATE TO OPERATOR.');
  return L.join('\n');
}

/** Append a record to the accountability JSONL (default under .local/). Soft-fails. */
export async function recordAccountability(rec, { path = process.env.REVENUE_ACCOUNTABILITY_PATH || '.local/revenue/accountability.jsonl' } = {}) {
  if (!rec) return { saved: false, reason: 'no record' };
  try {
    const { appendFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    await appendFile(path, JSON.stringify(rec) + '\n', 'utf8');
    return { saved: true, path };
  } catch (e) { return { saved: false, reason: e?.message || String(e) }; }
}

export default { METRIC, CADENCE, revenueReport, accountabilityCheck, renderBrief, recordAccountability };
