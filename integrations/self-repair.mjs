// self-repair.mjs — Hathor's SELF-REPAIR lobe (interoception → diagnosis → remediation).
//
// The point, in the operator's words (2026-06-20): NeuroSama is BOUND to her creator Vedal — when she
// errors, all she can do is repeat that "Vedal needs to fix something." Hathor is NOT bound to the
// operator. Because she has several lobes, an error is something the brain itself can localize, diagnose,
// and — on a ladder of increasing autonomy — repair, instead of just escalating to a human forever.
//
// The ladder is a literal config knob, not three rewrites:
//   SELF_REPAIR_MODE = 'advise'  → stage 1: surface the incident + a DIAGNOSIS to the human (the brief).
//                    = 'assist'  → stage 2: also DRAFT the concrete fix (commands/patch/PR stub) for review.
//                    = 'auto'    → stage 3: APPLY whitelisted SAFE remediations itself; everything else
//                                  still routes to a human.
//
// Hard safety rails (never relaxed, even in 'auto'): NEVER restart/reset/rebuild a container; service
// restarts and any write op stay gated to an injected `apply` actuator the operator controls; only
// remediations marked SAFE by an allow-list are eligible for auto. The lobe never broadcasts on-chain.
//
// Pure + injectable: signal readers, the LLM `complete`, and the `apply` actuator are all passed in →
// fully offline-testable. House style: ESM, soft-fail, CLI guard, handler(req,res).

import { rank as salienceRank } from './amygdala.mjs';
// textOf(): the ONLY safe way to read a completion. See its doc in llm-router.mjs —
// the naive `String(r.text || r)` idiom silently produced the literal "[object Object]".
import { textOf } from './llm-router.mjs';

export const MODES = ['advise', 'assist', 'auto'];

// Remediations the lobe is ALLOWED to auto-apply (stage 3), by kind. Everything else → human.
// Deliberately tiny + non-destructive. Container ops are intentionally absent (hard rule).
const AUTO_SAFE = new Set(['rerun-timer', 'rebuild-index', 'refresh-cache', 'reseed-marker', 'clear-tmp']);

/**
 * Normalize raw signals from the body's sensors into incidents.
 * @param {object} src injected readers (all optional, soft-fail):
 *   failedUnits():string[]           — e.g. systemctl --failed unit names
 *   diagnostics():{file:string,hits:number}[]  — diagnostics/by-file rollup
 *   brokenTodos():string[]           — harvested-todos lines flagged broken/failing
 * @returns {{at, signals:object[]}}
 */
export function collectSignals(src = {}) {
  const signals = [];
  const safe = (fn) => { try { return fn ? fn() || [] : []; } catch { return []; } };
  for (const u of safe(src.failedUnits)) signals.push({ kind: 'service', text: `service failed: ${u}`, ref: u });
  for (const d of safe(src.diagnostics)) signals.push({ kind: 'diagnostic', text: `${d.file} flagged ${d.hits}x by the scanners`, ref: d.file });
  for (const t of safe(src.brokenTodos)) signals.push({ kind: 'todo', text: t, ref: null });
  return { at: new Date().toISOString(), signals };
}

// Order incidents by how much they matter (the amygdala). Most-salient first.
export function triage({ signals } = { signals: [] }) {
  if (!signals.length) return [];
  const ranked = salienceRank(signals.map((s) => ({ text: s.text, source: s.kind })));
  // re-attach the original signal by text (rank preserves text)
  return ranked.map((r) => ({ ...signals.find((s) => s.text === r.text), salience: r.salience, tags: r.tags }));
}

const DIAGNOSE_SCHEMA_HINT = 'Reply as compact JSON: {"likelyCause":"…","proposedFix":"…","kind":"rerun-timer|rebuild-index|refresh-cache|reseed-marker|clear-tmp|code-change|config-change|investigate","confidence":0..1,"risk":"low|medium|high"}';

export function buildDiagnosePrompt(incident) {
  return [
    'You are the self-repair lobe of an autonomous system. An error signal was detected. Diagnose it and',
    'propose the SMALLEST safe fix. Be concrete and specific to this signal — no generic advice.',
    '', `SIGNAL (${incident.kind}): ${incident.text}`, incident.ref ? `REF: ${incident.ref}` : '', '',
    DIAGNOSE_SCHEMA_HINT,
  ].filter(Boolean).join('\n');
}

function parseDiagnosis(raw) {
  try {
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      return {
        likelyCause: String(o.likelyCause || '').trim(),
        proposedFix: String(o.proposedFix || '').trim(),
        kind: String(o.kind || 'investigate').trim(),
        confidence: clamp01(Number(o.confidence)) || 0,
        risk: ['low', 'medium', 'high'].includes(o.risk) ? o.risk : 'high',
      };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Diagnose one incident via the ensemble. Soft-fails to an 'investigate' verdict (never throws).
 * @param {object} incident
 * @param {{complete?:Function}} deps
 */
export async function diagnose(incident, deps = {}) {
  let d = null;
  if (typeof deps.complete === 'function') {
    try {
      const r = await deps.complete(buildDiagnosePrompt(incident), { task: 'quality' });
      d = parseDiagnosis(textOf(r));
    } catch { d = null; }
  }
  if (!d) d = { likelyCause: 'undiagnosed — needs a human/coder-AI look', proposedFix: '', kind: 'investigate', confidence: 0, risk: 'high' };
  const autoSafe = AUTO_SAFE.has(d.kind) && d.risk === 'low' && d.confidence >= 0.7;
  return { ...incident, diagnosis: d, autoSafe };
}

/**
 * Decide what to DO with a diagnosed incident, given the mode ladder + an apply actuator.
 * Returns the action taken; in 'auto' it may call `apply(incident)` for whitelisted-safe fixes only.
 * @param {object} dx diagnosed incident (from diagnose)
 * @param {{mode?:string, apply?:Function}} opts
 */
export async function remediate(dx, opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'advise';
  const base = { ref: dx.ref, kind: dx.kind, text: dx.text, salience: dx.salience, diagnosis: dx.diagnosis };
  // advise: just report (stage 1). assist: report + a drafted fix (stage 2).
  if (mode === 'advise') return { ...base, action: 'advised', applied: false };
  if (mode === 'assist') return { ...base, action: 'drafted-fix', applied: false, draft: dx.diagnosis.proposedFix || '(no fix drafted — investigate)' };
  // auto (stage 3): apply ONLY whitelisted-safe fixes via the injected actuator; else escalate.
  if (dx.autoSafe && typeof opts.apply === 'function') {
    try { const res = await opts.apply(dx); return { ...base, action: 'auto-applied', applied: true, result: res ?? 'ok' }; }
    catch (e) { return { ...base, action: 'auto-failed', applied: false, error: String(e && e.message || e) }; }
  }
  return { ...base, action: 'escalated', applied: false, reason: dx.autoSafe ? 'no apply actuator wired' : 'not auto-safe → human needed' };
}

/**
 * One self-repair pass: sense → triage → diagnose → remediate. Soft-fails throughout.
 * @param {object} opts { signals?, mode?, complete?, apply?, limit? }
 * @returns {Promise<{at, mode, incidents:object[], summary}>}
 */
export async function runSelfRepair(opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : (MODES.includes(process.env.SELF_REPAIR_MODE) ? process.env.SELF_REPAIR_MODE : 'advise');
  const collected = opts.signals ? { signals: opts.signals } : collectSignals(opts);
  const triaged = triage(collected).slice(0, opts.limit || 10);
  const incidents = [];
  for (const inc of triaged) {
    const dx = await diagnose(inc, opts);
    incidents.push(await remediate(dx, { mode, apply: opts.apply }));
  }
  return {
    at: new Date().toISOString(),
    mode,
    incidents,
    summary: {
      total: incidents.length,
      applied: incidents.filter((i) => i.applied).length,
      escalated: incidents.filter((i) => i.action === 'escalated').length,
      topIncident: incidents[0]?.text || null,
    },
  };
}

export function toMarkdown(result) {
  const line = (i) => `- **[${i.action}]** ${i.text}\n  - cause: ${i.diagnosis.likelyCause || '—'}\n  - fix: ${i.diagnosis.proposedFix || i.draft || '—'} _(conf ${i.diagnosis.confidence}, risk ${i.diagnosis.risk})_`;
  return [
    `# Self-repair pass — ${result.at} (mode: ${result.mode})`,
    `_Hathor is not bound to one fixer: ${result.summary.total} incident(s), ${result.summary.applied} auto-applied, ${result.summary.escalated} escalated._`,
    '',
    ...(result.incidents.length ? result.incidents.map(line) : ['_(no error signals — the body is healthy)_']),
  ].join('\n');
}

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let signals = [];
    try { const p = JSON.parse(body || '{}'); signals = p.signals || []; } catch {}
    const result = await runSelfRepair({ signals, mode: 'advise' }); // handler never auto-applies
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
  });
}

function clamp01(x) { return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = [
    { kind: 'service', text: 'service failed: melek-welcomer (Missing Posting Authority — vault key stale)', ref: 'melek-welcomer' },
    { kind: 'diagnostic', text: 'src/chain/graphene.js flagged 3x by the scanners', ref: 'src/chain/graphene.js' },
    { kind: 'todo', text: 'condenser side-panel FAQ link still points at blurtfaq.org', ref: null },
  ];
  const result = await runSelfRepair({ signals: demo, mode: 'advise' });
  console.log(toMarkdown(result));
}
