// new-user-stitch.mjs — models the WHOLE new-user journey as ONE verifiable pipeline (#296).
//
// The new-user flow is spread across four subsystems that each ship + test on their own:
//   signup/    — account creation (signup/server.mjs handler, signup/account-create.mjs prepareAccountCreation/submit)
//   welcomer/  — the welcome touch once an account exists (welcomer/index.js Welcomer)
//   tutorial/  — staged onboarding (tutorial/composers.mjs composeLessonPost, tutorial/state.js TutorialState)
//   (first-post) — the user publishes their first comment/post on-chain
//
// This module does NOT re-implement any of them. It STITCHES them: given a set of injected
// step functions (deps) it runs the canonical ordered steps, short-circuiting on the first
// failure, and returns a single legible verdict. That makes the end-to-end journey one thing
// a test (or a live e2e probe) can assert on, instead of four disconnected green suites.
//
// House style: ESM .mjs, injectable IO seams (the step fns ARE the seam — pass fakes in tests),
// soft-fail-never-throw (a throwing step becomes {ok:false}), esc() any HTML, CLI guarded.
//
//   import { stitchFlow, describeFlow, STEPS } from './new-user-stitch.mjs';
//   const r = await stitchFlow(STEPS, deps);   // r = { ok, completed:[...], failedAt, results }
//
// CLI:
//   node integrations/new-user-stitch.mjs            # prints the ordered flow (describeFlow)
//   node integrations/new-user-stitch.mjs --json     # same, machine-readable

// ---- the canonical ordered flow -------------------------------------------------------------

export const STEPS = Object.freeze([
  { key: 'signup', desc: 'Create the account: validate the requested name + public keys, then broadcast account_create (signup/).' },
  { key: 'welcomer', desc: 'Send the welcome touch once the account exists on-chain (welcomer/).' },
  { key: 'tutorial-start', desc: 'Open the staged tutorial: seat the new user at lesson 1 and compose the first lesson (tutorial/).' },
  { key: 'first-post', desc: "Publish the user's first comment/post on-chain — the journey's success signal." },
]);

export function describeFlow() {
  return STEPS.map((s, i) => ({ order: i + 1, key: s.key, desc: s.desc }));
}

// ---- HTML escape (for any rendered output) --------------------------------------------------

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- normalize a step result ----------------------------------------------------------------
// A dep step fn may return: a bool, or { ok, ... }, or undefined (treated as failure-unknown),
// or throw. We normalize everything to { ok:boolean, ...rest } and never throw outward.

function normalize(raw) {
  if (raw === true) return { ok: true };
  if (raw === false || raw == null) return { ok: false };
  if (typeof raw === 'object') {
    return { ...raw, ok: raw.ok === true };
  }
  // any other truthy scalar => treat as opaque-but-ok
  return { ok: !!raw, value: raw };
}

// ---- the stitcher ---------------------------------------------------------------------------
// steps: ordered [{ key, desc }]  (defaults to STEPS)
// deps:  { [key]: async (ctx) => boolean | {ok, ...} }   — the injectable seam for each step.
// Each step receives a shared ctx that accumulates prior step outputs under ctx[key].
// Runs in order; the FIRST failure short-circuits. Soft-fail: a missing or throwing dep is a
// failure for that step, recorded, and stops the pipeline — it never throws to the caller.

export async function stitchFlow(steps = STEPS, deps = {}, { ctx = {} } = {}) {
  const completed = [];
  const results = [];
  let failedAt = null;

  for (const step of steps) {
    const fn = deps[step.key];
    let res;
    if (typeof fn !== 'function') {
      res = { ok: false, error: `no dep provided for step "${step.key}"` };
    } else {
      try {
        res = normalize(await fn(ctx));
      } catch (e) {
        res = { ok: false, error: `step "${step.key}" threw: ${e && e.message ? e.message : String(e)}` };
      }
    }

    results.push({ key: step.key, ...res });
    ctx[step.key] = res;

    if (res.ok) {
      completed.push(step.key);
    } else {
      failedAt = step.key;
      break; // short-circuit on first failure
    }
  }

  return { ok: failedAt === null, completed, failedAt, results, ctx };
}

// ---- render (human report) ------------------------------------------------------------------

export function renderFlow(rep) {
  const lines = [`new-user-stitch — ${rep.ok ? 'PASS (full journey)' : `FAIL at "${rep.failedAt}"`}`];
  for (const r of rep.results) {
    const mark = r.ok ? '✓' : '✗';
    const detail = r.error ? ` — ${r.error}` : '';
    lines.push(`  ${mark} ${r.key}${detail}`);
  }
  const ran = new Set(rep.results.map((r) => r.key));
  for (const s of STEPS) if (!ran.has(s.key)) lines.push(`  · ${s.key} — skipped (prior failure)`);
  return lines.join('\n');
}

// ---- CLI ------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const flow = describeFlow();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(flow, null, 2));
  } else {
    console.log('new-user flow (#296):');
    for (const s of flow) console.log(`  ${s.order}. ${s.key} — ${s.desc}`);
  }
}
