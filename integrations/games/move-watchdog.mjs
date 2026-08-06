// move-watchdog.mjs — anomaly detection for the MELEK Move walk-to-earn payout ("is walking being hacked?").
//
// Walking is the one part of MELEK with NO on-chain proof — step data is off-chain, attested each hour by
// the move attester's `move_pay` custom_json. That makes it the most gameable surface, so we watch it.
//
// The PRIMARY alarm is on-chain and unit-independent: after the HF25 gate the "move" reward fund can be
// drained ONLY by `move_pay`, and the chain caps each draw at MELEK_MOVE_EPOCH_PAY_CAP_AMOUNT (150 MELEK).
// So the fund can drop by at most `cap × (number of move_pay ops)`. If it drops faster, the cap is being
// bypassed or the attester key is compromised → CRITICAL. Secondary signals catch off-chain fakery
// (implausible per-walker weight = fake steps; walker-count spikes = sybil) and attester misbehaviour
// (paying itself, extreme concentration).
//
// PURE + soft-fail: analyzeMove(current, previous, cfg) -> { ok, level, alerts:[{level,code,msg,detail}] }.
// The runner (move-watchdog-run.mjs) supplies the snapshots (chain + ledger) and routes alerts to Telegram.

const num = (v) => { const n = Number(String(v ?? '').split(' ')[0]); return Number.isFinite(n) ? n : 0; };

export const DEFAULTS = {
  capPerEpoch: 150,                 // MELEK_MOVE_EPOCH_PAY_CAP_AMOUNT / 1000
  drainMargin: 1.10,                // 10% slack over the theoretical max drain before we cry wolf
  maxWalkerWeightPerEpoch: 100000,  // off-chain plausibility ceiling for ONE walker in ONE hour (tune)
  maxWalkersPerEpoch: 5000,         // sybil ceiling: implausibly many distinct walkers in one hour
  epochJumpMargin: 3,               // move_pay epoch may lead the clock by at most this many hours
  concentrationPct: 0.9,            // one account taking >90% of attested weight in the window = warn
  attester: 'hathor',               // the account that signs move_pay (self-pay is a red flag)
};

/**
 * @param {object} current  { fund:number, epoch:number, ts:number(sec),
 *                            movePays:[{epoch:number, pay:[[acct,weight]], ts?:number}],
 *                            ledger:{ [epoch]: { [acct]: weight } } }
 * @param {object|null} previous  { fund:number, epoch:number, ts:number } — last snapshot (null on first run)
 * @param {object} [cfg]  overrides of DEFAULTS
 * @returns {{ok:boolean, level:'ok'|'warn'|'critical', alerts:Array}}
 */
export function analyzeMove(current = {}, previous = null, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const alerts = [];
  const add = (level, code, msg, detail) => alerts.push({ level, code, msg, detail });
  try {
    const fund = num(current.fund);
    const movePays = Array.isArray(current.movePays) ? current.movePays : [];
    const ledger = current.ledger && typeof current.ledger === 'object' ? current.ledger : {};
    // legit settling is ~1 epoch/hour, so bound expectations by ELAPSED TIME, never by the observed
    // payout count (an attacker could inflate the count to mask a drain — epochs aren't time-gated).
    const hours = (previous && Number.isFinite(previous.ts) && Number.isFinite(current.ts))
      ? Math.max(1, Math.round((current.ts - previous.ts) / 3600)) : null;

    // ── 1. PRIMARY: fund draining faster than ~1 capped payout per hour ──────────────────────────────
    if (previous && Number.isFinite(num(previous.fund))) {
      const netDrop = num(previous.fund) - fund;                 // >0 means the fund shrank
      const h = hours != null ? hours : 1;                       // no timestamp → assume a single hour
      const maxLegitDrop = c.capPerEpoch * h * c.drainMargin;
      if (netDrop > maxLegitDrop && netDrop > c.capPerEpoch * 0.5) {
        add('critical', 'fund_drain',
          `Move fund dropped ${netDrop.toFixed(3)} MELEK in ~${h}h — legit max is ~${(c.capPerEpoch * h).toFixed(0)} (${c.capPerEpoch}/hr). Cap bypassed or attester compromised.`,
          { netDrop, hours: h, maxLegitDrop });
      }
    }

    // ── 2. move_pay frequency: at most ~1 per hour; a burst = someone racing the epoch guard ─────────
    if (hours != null) {
      if (movePays.length > hours + 1) {
        add('critical', 'payout_burst',
          `${movePays.length} move_pay ops in ~${hours}h (expected ≤ ${hours + 1}) — attester spamming epochs`,
          { count: movePays.length, hours });
      }
      // epoch guard leaping far past wall-clock hours = epochs being burned
      if (Number.isFinite(previous.epoch) && Number.isFinite(current.epoch)) {
        const jump = current.epoch - previous.epoch;
        if (jump > hours + c.epochJumpMargin) {
          add('warn', 'epoch_jump', `move epoch advanced ${jump} in ~${hours}h`, { jump, hours });
        }
      }
    }

    // ── 3. attester self-pay + concentration (from the signed pay lists) ─────────────────────────────
    const weightByAcct = {};
    let totalWeight = 0;
    for (const mp of movePays) {
      for (const row of (mp.pay || [])) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const acct = String(row[0]); const w = Number(row[1]) || 0;
        weightByAcct[acct] = (weightByAcct[acct] || 0) + w;
        totalWeight += w;
      }
    }
    if (weightByAcct[c.attester]) {
      add('critical', 'attester_self_pay',
        `attester ${c.attester} appears as a paid walker — the oracle must never pay itself`,
        { weight: weightByAcct[c.attester] });
    }
    if (totalWeight > 0) {
      for (const [acct, w] of Object.entries(weightByAcct)) {
        if (acct === c.attester) continue;
        if (w / totalWeight > c.concentrationPct && Object.keys(weightByAcct).length > 1) {
          add('warn', 'concentration', `${acct} took ${(100 * w / totalWeight).toFixed(0)}% of attested weight in the window`, { acct, share: w / totalWeight });
        }
      }
    }

    // ── 4. off-chain fakery: implausible per-walker weight (fake steps) / walker-count spike (sybil) ──
    for (const [epoch, weights] of Object.entries(ledger)) {
      if (!weights || typeof weights !== 'object') continue;
      const entries = Object.entries(weights);
      const walkerCount = entries.length;
      if (walkerCount > c.maxWalkersPerEpoch) {
        add('warn', 'walker_spike', `epoch ${epoch}: ${walkerCount} walkers (> ${c.maxWalkersPerEpoch}) — possible sybil farm`, { epoch, walkerCount });
      }
      for (const [acct, w] of entries) {
        if (Number(w) > c.maxWalkerWeightPerEpoch) {
          add('warn', 'implausible_walker', `epoch ${epoch}: ${acct} accrued weight ${Math.round(Number(w))} (> ${c.maxWalkerWeightPerEpoch}) — likely fake steps`, { epoch, acct, weight: Number(w) });
        }
      }
    }
  } catch (e) {
    add('warn', 'watchdog_error', `watchdog analysis error: ${String((e && e.message) || e).slice(0, 120)}`);
  }

  const level = alerts.some((a) => a.level === 'critical') ? 'critical' : alerts.length ? 'warn' : 'ok';
  return { ok: level === 'ok', level, alerts };
}

/** Render a compact alarm message for Telegram/logs. */
export function formatAlerts(result, { chain = 'MELEK', fund } = {}) {
  if (!result || result.ok) return '';
  const icon = result.level === 'critical' ? '🚨' : '⚠️';
  const head = `${icon} MELEK Move watchdog — ${result.level.toUpperCase()}${fund != null ? ` (fund ${Number(fund).toFixed(0)} ${chain})` : ''}`;
  const lines = result.alerts.map((a) => `• [${a.code}] ${a.msg}`);
  return [head, ...lines].join('\n');
}
