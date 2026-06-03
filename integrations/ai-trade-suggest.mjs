// ai-trade-suggest.mjs — the AI-driven trade-SUGGESTION layer that sits ON TOP of the deterministic
// presets (queue #64). It takes a market snapshot + the arb/market-entry findings + current holdings
// and produces RANKED, reasoned suggestions with a human-readable rationale.
//
// ADVISORY ONLY. This module never trades, holds no keys, broadcasts nothing. Execution is a
// separate, gated, MELEK-Signer-only concern (zero-WIF rule). All it emits is a sorted list a human
// (or the analyzer/AIs) can read.
//
// PARADIGM-ROUTER idea (queue #90), applied here:
//   1. DETERMINISTIC SCORING FIRST (cheap, pure, free):  scoreSuggestion(candidate)
//      = edge × liquidity × jurisdiction − risk.  This does ALL the ranking. No model involved.
//   2. ESCALATE TO AN LLM only to WRITE THE HUMAN-READABLE RATIONALE — and even then it is
//      INJECTED and SOFT-FAILS: no llm (or an llm that throws/returns nothing) → we fall back to a
//      templated rationale built from the same numbers. The LLM never changes the ranking, never
//      changes the action, never changes the size. It is pure prose-polish on top of the math.
//
// THE BLEED-GUARD LESSON (the SWAP.LTC −6,424 HIVE drain): never suggest one-way accumulation.
// A standalone BUY with no selling leg on a token we're already net-long is how the operator bled
// HIVE. So: a BUY candidate that has no paired sell signal and is already net-held is DOWNGRADED to
// a 'WATCH' (never an actionable BUY), its risk is forced high, and the rationale says why. Risk is
// always capped into [0,1] and every suggestion carries a risk band the caller can threshold on.
//
//   import { suggest, scoreSuggestion } from './integrations/ai-trade-suggest.mjs';
//   const ranked = await suggest({ snapshot, entries, holdings }, { llm });
//
// CLI:  node integrations/ai-trade-suggest.mjs            # demo against a tiny built-in fixture

// ── tunables (pure constants; no env, no I/O) ────────────────────────────────────────────────
const RISK_CAP = 1; // risk is always clamped into [0, RISK_CAP]
const RISK_FLOOR = 0; // …and never negative
const HIGH_RISK = 0.7; // at/above → 'high' band; a forced-high one-way buy lands here
const MED_RISK = 0.4; // at/above → 'medium' band

// Jurisdiction weighting: a token/venue we treat as clean ranks ahead of a sanctioned/grey one,
// all else equal. Multiplicative so it can only ever *discount* a risky jurisdiction, never inflate.
const JURISDICTION_WEIGHT = {
  clean: 1.0,
  unknown: 0.85,
  grey: 0.5,
  restricted: 0.15,
};

const clamp01 = (n) => Math.max(RISK_FLOOR, Math.min(RISK_CAP, Number.isFinite(n) ? n : RISK_FLOOR));
const num = (n, d = 0) => (Number.isFinite(n) ? n : d);

/**
 * PURE deterministic score for one candidate. This is the WHOLE ranking signal — no model.
 *
 *   score = edge × liquidity × jurisdiction − risk
 *
 * - edge:        expected fractional edge (e.g. 0.05 = 5%). Negative edge → negative score.
 * - liquidity:   how much we can actually move, normalised into [0,1] (executable depth / target).
 * - jurisdiction: 'clean' | 'unknown' | 'grey' | 'restricted'  → multiplier in (0,1].
 * - risk:        [0,1], clamped. Subtracted last so a high-risk idea can go net-negative.
 *
 * @param {{edge?:number, liquidity?:number, jurisdiction?:string, risk?:number}} candidate
 * @returns {number}
 */
export function scoreSuggestion(candidate = {}) {
  const edge = num(candidate.edge, 0);
  const liquidity = clamp01(candidate.liquidity); // liquidity is a [0,1] confidence/normalised depth
  const jur = JURISDICTION_WEIGHT[candidate.jurisdiction] ?? JURISDICTION_WEIGHT.unknown;
  const risk = clamp01(candidate.risk);
  const raw = edge * liquidity * jur - risk;
  return +raw.toFixed(6);
}

function riskBand(risk) {
  const r = clamp01(risk);
  if (r >= HIGH_RISK) return 'high';
  if (r >= MED_RISK) return 'medium';
  return 'low';
}

// Build the candidate set from the inputs. Each finding becomes a candidate with an edge/liquidity/
// jurisdiction/risk and a proposed action; holdings are folded in to detect one-way accumulation.
function buildCandidates({ snapshot = {}, entries = [], holdings = {} } = {}) {
  const held = normaliseHoldings(holdings);
  const findings = collectFindings(snapshot, entries);
  return findings.map((f) => candidateFromFinding(f, held));
}

// Holdings can arrive as { 'SWAP.LTC': 12.3, ... } or as [{ symbol, balance }]. Normalise to a map.
function normaliseHoldings(holdings) {
  const map = {};
  if (Array.isArray(holdings)) {
    for (const h of holdings) {
      if (h && h.symbol) map[h.symbol] = num(h.balance ?? h.amount ?? h.quantity, 0);
    }
  } else if (holdings && typeof holdings === 'object') {
    for (const [k, v] of Object.entries(holdings)) map[k] = num(typeof v === 'object' ? v.balance : v, 0);
  }
  return map;
}

// Pull a flat list of {market, action, edge, liquidity, jurisdiction, risk, paired, note} from the
// snapshot's opportunities and the market-entry findings. Tolerant of shape: we read common fields.
function collectFindings(snapshot, entries) {
  const out = [];
  const fromSnap = Array.isArray(snapshot.opportunities) ? snapshot.opportunities : [];
  for (const o of fromSnap) {
    out.push({
      market: o.market || o.sym || o.symbol || 'UNKNOWN',
      action: (o.action || o.side || 'BUY').toUpperCase(),
      edge: num(o.edge ?? o.spread, 0),
      liquidity: liquidityOf(o, snapshot),
      jurisdiction: o.jurisdiction || 'unknown',
      risk: num(o.risk, undefined),
      paired: hasPairedLeg(o),
      note: o.reason || o.note || '',
    });
  }
  for (const e of Array.isArray(entries) ? entries : []) {
    out.push({
      market: e.market || e.sym || e.symbol || 'UNKNOWN',
      action: (e.action || e.side || 'BUY').toUpperCase(),
      edge: num(e.edge ?? e.score, 0),
      liquidity: liquidityOf(e, snapshot),
      jurisdiction: e.jurisdiction || 'unknown',
      risk: num(e.risk, undefined),
      paired: hasPairedLeg(e),
      note: e.reason || e.note || '',
    });
  }
  return out;
}

// Normalise whatever depth signal a finding carries into a [0,1] liquidity number.
function liquidityOf(f, snapshot) {
  if (Number.isFinite(f.liquidity)) return clamp01(f.liquidity);
  // executable HIVE depth normalised against a target (arb-scanner emits execHive)
  const exec = num(f.execHive ?? f.depthHive ?? f.executableHive, NaN);
  if (Number.isFinite(exec)) {
    const target = num(snapshot.liquidityTargetHive, 100); // 100 HIVE of depth ≈ "full" liquidity
    return clamp01(exec / target);
  }
  return 0.5; // unknown depth → neutral, never assume deep
}

// A finding has a paired (offsetting) leg if it explicitly says so or carries an exit/sell plan.
function hasPairedLeg(f) {
  if (f.paired === true) return true;
  if (f.exit || f.sellLeg || f.takeProfit) return true;
  // an explicit SELL or a round-trip arb is inherently paired
  const a = String(f.action || f.side || '').toUpperCase();
  return a === 'SELL' || a === 'ARB' || a === 'ROUNDTRIP';
}

// Turn one finding into a scored candidate, applying the bleed-guard.
function candidateFromFinding(f, held) {
  let action = f.action;
  let risk = Number.isFinite(f.risk) ? clamp01(f.risk) : baselineRisk(f);
  const guardNotes = [];

  // ── BLEED-GUARD: no one-way accumulation (the SWAP.LTC lesson) ──────────────────────────────
  // A BUY with no offsetting sell leg, on a token we are already net-long, is exactly the drain
  // that cost the operator. We refuse to surface it as an actionable BUY: downgrade to WATCH and
  // force risk high so it can never out-rank a clean two-sided idea.
  const isAccumulatingBuy = action === 'BUY' && !f.paired && (held[f.market] || 0) > 0;
  if (isAccumulatingBuy) {
    action = 'WATCH';
    risk = Math.max(risk, HIGH_RISK);
    guardNotes.push(
      'one-way accumulation guard: already net-long with no selling leg — downgraded to WATCH (SWAP.LTC bleed lesson)',
    );
  }
  // An un-paired BUY even on an unheld token carries extra risk (no exit planned).
  else if (action === 'BUY' && !f.paired) {
    risk = clamp01(risk + 0.1);
    guardNotes.push('un-paired BUY (no exit leg planned) — risk nudged up');
  }

  const candidate = {
    market: f.market,
    action,
    edge: num(f.edge, 0),
    liquidity: clamp01(f.liquidity),
    jurisdiction: f.jurisdiction || 'unknown',
    risk: clamp01(risk),
    paired: Boolean(f.paired),
    held: held[f.market] || 0,
    note: f.note || '',
    guardNotes,
  };
  candidate.score = scoreSuggestion(candidate);
  return candidate;
}

// A baseline risk estimate when a finding doesn't carry one: thin liquidity and grey jurisdiction
// raise it; a strong edge lowers it slightly. Always clamped.
function baselineRisk(f) {
  let r = 0.3;
  const jurDiscount = JURISDICTION_WEIGHT[f.jurisdiction] ?? JURISDICTION_WEIGHT.unknown;
  r += (1 - jurDiscount) * 0.4; // worse jurisdiction → more risk
  r += (1 - clamp01(f.liquidity)) * 0.3; // thinner book → more risk
  r -= Math.min(num(f.edge, 0), 0.2) * 0.5; // a fat edge shaves a little risk
  return clamp01(r);
}

// ── rationale: LLM if injected & it works, else a templated fallback ─────────────────────────
function templatedRationale(c) {
  const pct = (n) => `${(num(n, 0) * 100).toFixed(1)}%`;
  const parts = [];
  parts.push(
    `${c.action} ${c.market}: ~${pct(c.edge)} edge, liquidity ${c.liquidity.toFixed(2)}, ` +
      `${c.jurisdiction} jurisdiction, risk ${riskBand(c.risk)} (${c.risk.toFixed(2)}), score ${c.score.toFixed(3)}.`,
  );
  if (c.held > 0) parts.push(`Already holding ${c.held} ${c.market}.`);
  if (c.note) parts.push(c.note);
  for (const g of c.guardNotes || []) parts.push(g);
  parts.push('Advisory only — not executed.');
  return parts.join(' ');
}

function rationalePrompt(c) {
  return (
    'You are a cautious trading analyst. In 1-2 sentences, explain this ADVISORY suggestion for a ' +
    'human reader. Be concrete about edge, liquidity, jurisdiction and risk. Do NOT tell anyone to ' +
    'execute it; it is advisory only. Never recommend one-way accumulation.\n\n' +
    `Candidate: ${JSON.stringify({
      market: c.market,
      action: c.action,
      edge: c.edge,
      liquidity: c.liquidity,
      jurisdiction: c.jurisdiction,
      risk: c.risk,
      held: c.held,
      score: c.score,
      guards: c.guardNotes,
    })}`
  );
}

// Resolve the LLM rationale, soft-failing to the template on ANY problem (no llm, throws, empty).
async function rationaleFor(c, llm) {
  if (!llm || typeof llm.complete !== 'function') return templatedRationale(c);
  try {
    const res = await llm.complete(rationalePrompt(c), { task: 'cheap', maxTokens: 160 });
    const text = (res && typeof res.text === 'string' ? res.text : '').trim();
    if (!text) return templatedRationale(c);
    return text;
  } catch {
    return templatedRationale(c);
  }
}

/**
 * Produce RANKED, reasoned, advisory trade suggestions.
 *
 * Deterministic scoring decides the order (cheap, pure). The LLM — if injected and working — only
 * writes the prose rationale; otherwise we use a templated one. Never trades, never executes.
 *
 * @param {object} inputs
 * @param {object} [inputs.snapshot]   market snapshot; .opportunities[] is the main signal source
 * @param {Array}  [inputs.entries]    market-entry / arb findings
 * @param {object|Array} [inputs.holdings] current holdings (map symbol→balance, or [{symbol,balance}])
 * @param {object} [opts]
 * @param {{complete:Function}} [opts.llm]  injected LLM (e.g. llm-router); soft-fails if absent/broken
 * @returns {Promise<Array<{market,action,sizeHint,rationale,confidence,risk,score}>>}
 */
export async function suggest({ snapshot = {}, entries = [], holdings = {} } = {}, { llm } = {}) {
  const candidates = buildCandidates({ snapshot, entries, holdings });

  // DETERMINISTIC ranking FIRST — best score first, tie-break on lower risk then market name.
  candidates.sort(
    (a, b) => b.score - a.score || a.risk - b.risk || a.market.localeCompare(b.market),
  );

  const out = [];
  for (const c of candidates) {
    const rationale = await rationaleFor(c, llm); // LLM only writes prose; never reorders
    out.push({
      market: c.market,
      action: c.action,
      sizeHint: sizeHintFor(c),
      rationale,
      confidence: confidenceFor(c),
      risk: riskBand(c.risk),
      score: c.score,
    });
  }
  return out;
}

// A coarse, non-binding size hint. WATCH/guarded ideas never carry a position size.
function sizeHintFor(c) {
  if (c.action === 'WATCH') return 'none — watch only';
  // scale with liquidity, shrink with risk; deliberately conservative bands, never a HIVE amount.
  const appetite = clamp01(c.liquidity) * (1 - clamp01(c.risk));
  if (appetite >= 0.6) return 'standard';
  if (appetite >= 0.3) return 'small';
  return 'minimal';
}

// Confidence in [0,1]: edge & liquidity up, risk down. Independent of the score's subtraction so a
// caller can threshold on it directly.
function confidenceFor(c) {
  const jur = JURISDICTION_WEIGHT[c.jurisdiction] ?? JURISDICTION_WEIGHT.unknown;
  const raw = clamp01(c.edge * 5) * clamp01(c.liquidity) * jur * (1 - clamp01(c.risk));
  return +clamp01(raw).toFixed(3);
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('ai-trade-suggest.mjs')) {
  const snapshot = {
    liquidityTargetHive: 100,
    opportunities: [
      { market: 'SWAP.BLURT', action: 'SELL', edge: 0.06, execHive: 80, jurisdiction: 'clean', paired: true, reason: 'HE bid over real' },
      { market: 'SWAP.DOGE', action: 'ARB', edge: 0.04, execHive: 50, jurisdiction: 'clean', reason: 'round-trip arb' },
      { market: 'SWAP.LTC', action: 'BUY', edge: 0.05, execHive: 60, jurisdiction: 'unknown', reason: 'looks cheap' },
    ],
  };
  const holdings = { 'SWAP.LTC': 25 }; // already net-long LTC → bleed-guard must fire
  console.log('AI trade SUGGESTIONS — ADVISORY ONLY, no execution, no keys\n' + '─'.repeat(60));
  let llm;
  try {
    ({ complete: llm } = await import('./llm-router.mjs'));
    llm = { complete: llm }; // adapt to { complete } shape
  } catch {
    llm = undefined;
  }
  const ranked = await suggest({ snapshot, entries: [], holdings }, { llm });
  for (const s of ranked) {
    console.log(`\n[${s.action}] ${s.market}  score=${s.score.toFixed(3)} risk=${s.risk} conf=${s.confidence} size=${s.sizeHint}`);
    console.log(`  ${s.rationale}`);
  }
  console.log('\nExecution is intentionally NOT here: gated, MELEK-Signer-only (zero WIF on this host).');
}
