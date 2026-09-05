// pentecaust/herald/ifttt-executor.mjs — the missing half of Herald's IFTTT: the thing that ACTS.
//
// ifttt-triggers.mjs evaluates recipes and returns PLANNED actions. Its own header says the executor is
// "deliberately OUT OF SCOPE", and nothing in the repo ever executed one — so every recipe that has ever
// fired produced an object that was thrown away. The rules engine worked; nothing downstream of it did.
//
// This is that downstream. It executes ONLY the action types that need no key, and REFUSES the two that
// move value — which is the boundary ifttt-triggers drew on purpose and this module keeps:
//
//   notify   -> EXECUTED. Delivers a message through an injected notifier (Telegram/webhook/log).
//   webhook  -> EXECUTED. Plain HTTP POST to the recipe's target URL. No key, no signing.
//   reward   -> REFUSED. Moves tokens. Belongs behind MELEK-Signer, which this repo never holds.
//   post     -> REFUSED. Broadcasts to a chain. Same reason.
//
// A refused action is not an error — it is returned as { ok:false, requiresSigner:true } so an operator
// (or a signer-side runner) can pick it up. Refusing loudly beats executing something that should have
// been signed elsewhere.
//
// SSRF GUARD: webhook targets are validated before any fetch — https/http only, no localhost, no private
// ranges, no link-local, no metadata endpoints. A recipe is user-supplied input; it never reaches an
// arbitrary host unchecked.
//
// House style: ESM, injectable fetch + notifier + now, soft-fail-never-throw, fully offline-testable.
//
//   import { execute, executeAll, isSafeWebhookTarget, __setFetch } from './ifttt-executor.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

/** Action types this module will actually perform. Everything else is deliberately refused. */
export const KEYLESS_ACTIONS = ['notify', 'webhook'];
/** Action types that move value and must be signed elsewhere. */
export const SIGNER_ACTIONS = ['reward', 'post'];

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];

/**
 * isSafeWebhookTarget — a recipe's `target` is user input, so it is checked before any request.
 * Blocks non-http(s), credentials in the URL, localhost, private/link-local/CGNAT ranges, and the
 * cloud metadata endpoints. Returns { ok, reason }.
 */
export function isSafeWebhookTarget(target) {
  let u;
  try { u = new URL(String(target || '')); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: `blocked protocol ${u.protocol}` };
  if (u.username || u.password) return { ok: false, reason: 'credentials in URL' };
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return { ok: false, reason: 'localhost' };
  if (h === 'metadata.google.internal' || h === '169.254.169.254') return { ok: false, reason: 'cloud metadata endpoint' };
  if (PRIVATE_V4.some((re) => re.test(h))) return { ok: false, reason: 'private address range' };
  if (h.endsWith('.internal') || h.endsWith('.local')) return { ok: false, reason: 'internal hostname' };
  return { ok: true, reason: '' };
}

/**
 * execute(action, deps) — perform ONE planned action from ifttt-triggers.evaluate().
 * Never throws. Always returns a shaped result.
 *   -> { recipeId, action, ok, executed, requiresSigner?, status?, reason?, at }
 */
export async function execute(action, deps) {
  // Normalise BEFORE reading any field. A `= {}` default only fires on `undefined`, so an explicit
  // null — which is exactly what a junk feed or a failed upstream hands you — reached `.recipeId`
  // below and threw, breaking the never-throws contract this module's header promises.
  const act = action && typeof action === 'object' ? action : {};
  const dep = deps && typeof deps === 'object' ? deps : {};
  const now = typeof dep.now === 'function' ? dep.now : Date.now;
  const at = new Date(now()).toISOString();
  const base = { recipeId: act.recipeId || '', name: act.name || '', action: act.action || '', at };

  if (!act.action) return { ...base, ok: false, executed: false, reason: 'no action type' };

  if (SIGNER_ACTIONS.includes(act.action)) {
    // Not a failure — a deliberate handoff. This module holds no key by construction.
    return { ...base, ok: false, executed: false, requiresSigner: true,
      reason: `'${act.action}' moves value and must be signed by MELEK-Signer, not here` };
  }

  if (act.action === 'notify') {
    const notifier = typeof dep.notify === 'function' ? dep.notify : null;
    if (!notifier) return { ...base, ok: false, executed: false, reason: 'no notifier configured' };
    try {
      const msg = `[Herald] ${act.name || act.recipeId}: ${act.whenType || 'trigger'} "${act.tag || ''}" fired`;
      await notifier({ target: act.target, message: msg, action: act });
      return { ...base, ok: true, executed: true };
    } catch (e) { return { ...base, ok: false, executed: false, reason: (e && e.message) || 'notifier threw' }; }
  }

  if (act.action === 'webhook') {
    const guard = isSafeWebhookTarget(act.target);
    if (!guard.ok) return { ...base, ok: false, executed: false, reason: `unsafe target: ${guard.reason}` };
    try {
      const r = await _fetch(act.target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'MELEK-Herald/1.0' },
        body: JSON.stringify({
          recipeId: act.recipeId, name: act.name, tag: act.tag,
          whenType: act.whenType, event: act.event, at,
        }),
      });
      const status = r && typeof r.status === 'number' ? r.status : 0;
      const ok = !!(r && (r.ok === true || (status >= 200 && status < 300)));
      return { ...base, ok, executed: true, status, ...(ok ? {} : { reason: `HTTP ${status}` }) };
    } catch (e) { return { ...base, ok: false, executed: false, reason: (e && e.message) || 'request failed' }; }
  }

  return { ...base, ok: false, executed: false, reason: `unknown action type '${act.action}'` };
}

/** executeAll — run a batch of planned actions in order. Never throws; one failure never stops the rest. */
export async function executeAll(actions = [], deps = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const results = [];
  for (const a of list) results.push(await execute(a, deps));
  return {
    total: results.length,
    executed: results.filter((r) => r.executed).length,
    ok: results.filter((r) => r.ok).length,
    needSigner: results.filter((r) => r.requiresSigner).length,
    results,
  };
}

/** handler(req,res) — JSON summary of a batch, for the Herald dashboard. */
export function handler(req, res, summary = { total: 0, executed: 0, ok: 0, needSigner: 0, results: [] }) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(summary, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('ifttt-executor.mjs');
if (isMain) {
  const demo = [
    { recipeId: 'r1', name: 'notify on #prana', action: 'notify', target: 'ops', tag: 'prana', whenType: 'tag' },
    { recipeId: 'r2', name: 'webhook out', action: 'webhook', target: 'https://example.invalid/hook', tag: 'prana', whenType: 'tag' },
    { recipeId: 'r3', name: 'pay a reward', action: 'reward', target: 'alice', tag: 'prana', whenType: 'tag' },
    { recipeId: 'r4', name: 'internal probe', action: 'webhook', target: 'http://169.254.169.254/latest/meta-data/', tag: 'x', whenType: 'tag' },
  ];
  const out = await executeAll(demo, { notify: async ({ message }) => console.log('  NOTIFY:', message) });
  console.log(JSON.stringify(out, null, 2));
}
