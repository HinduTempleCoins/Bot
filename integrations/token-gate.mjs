// token-gate.mjs — PURE, deterministic token-gated role evaluator (Guild.xyz-style).
//
// The OFF-CHAIN DECISION LAYER ONLY. Maps queue ids 306/307/308 (token-gated roles,
// VKBT holders get access, wallet verification) — but this module decides nothing
// about wallets, chains, or signatures. The caller fetches balances elsewhere
// (chain reader / signer / cache) and hands this module a plain balances map.
//
//   No wallet calls. No chain. No signing. No network. No keys. Pure comparison.
//
// A holder's balances are a map { TOKEN: amountNumber }. Rules describe roles:
//   { token, minBalance, role }                       — single-token threshold (>=)
//   { role, allOf: [{ token, min }, ...] }            — multi-token AND-gate (all >=)
// allOf takes precedence when present. Missing/garbage balances are treated as 0.
//
// API:
//   esc(s)                              — HTML-escape any interpolated value
//   DEFAULT_TIERS                       — frozen example rule set
//   evaluateGate({balances, rules})     — { grantedRoles:[], deniedRoles:[{role,reason,short}] }
//   highestTier(balances, rules)        — single best granted role, or null
//   renderAccessBadge(account, result)  — esc()'d one-line HTML of granted roles
//
// Soft-fail, never throw: non-object input → { grantedRoles:[], deniedRoles:[] }.
//
//   import { evaluateGate, highestTier, renderAccessBadge } from './token-gate.mjs'
//   node integrations/token-gate.mjs            # print a worked example

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Example tiers. Frozen so callers can't mutate the shared default.
// Ordered loosely high→low, but ranking is by threshold, not array order.
export const DEFAULT_TIERS = Object.freeze([
  Object.freeze({ role: 'whale', token: 'VKBT', minBalance: 10000 }),
  Object.freeze({ role: 'member', token: 'VKBT', minBalance: 100 }),
  Object.freeze({ role: 'holder', token: 'VKBT', minBalance: 1 }),
]);

// Coerce any value to a finite non-negative number; garbage/missing → 0.
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Read a token balance out of an arbitrary balances object, soft.
function balanceOf(balances, token) {
  if (!balances || typeof balances !== 'object' || token == null) return 0;
  return num(balances[token]);
}

// Effective "weight" of a rule for ranking the best granted role.
// Single-token: its minBalance. AND-gate: the sum of its mins (more gates = higher).
function ruleWeight(rule) {
  if (rule && Array.isArray(rule.allOf)) {
    return rule.allOf.reduce((acc, c) => acc + num(c && c.min), 0);
  }
  return num(rule && rule.minBalance);
}

// Evaluate ONE rule against balances. Returns { ok, reason, short }.
function checkRule(balances, rule) {
  if (!rule || typeof rule !== 'object') {
    return { ok: false, reason: 'invalid rule', short: 'bad-rule' };
  }
  if (Array.isArray(rule.allOf)) {
    if (rule.allOf.length === 0) {
      return { ok: false, reason: 'empty allOf gate', short: 'no-conditions' };
    }
    const missing = [];
    for (const cond of rule.allOf) {
      const token = cond && cond.token;
      const need = num(cond && cond.min);
      const have = balanceOf(balances, token);
      if (have < need) missing.push(`${token}: ${have} < ${need}`);
    }
    if (missing.length) {
      return { ok: false, reason: `needs all of [${missing.join('; ')}]`, short: 'and-gate-unmet' };
    }
    return { ok: true, reason: 'all conditions met', short: 'ok' };
  }
  // single-token threshold
  const token = rule.token;
  const need = num(rule.minBalance);
  const have = balanceOf(balances, token);
  if (have < need) {
    return { ok: false, reason: `${token}: ${have} < ${need}`, short: 'below-min' };
  }
  return { ok: true, reason: `${token}: ${have} >= ${need}`, short: 'ok' };
}

// evaluateGate — main entry. Pure, soft-fail.
export function evaluateGate(input) {
  if (!input || typeof input !== 'object') return { grantedRoles: [], deniedRoles: [] };
  const balances = (input.balances && typeof input.balances === 'object') ? input.balances : {};
  const rules = Array.isArray(input.rules) ? input.rules : [];

  const grantedRoles = [];
  const deniedRoles = [];
  for (const rule of rules) {
    const role = rule && rule.role != null ? String(rule.role) : '';
    if (!role) {
      deniedRoles.push({ role: '', reason: 'rule missing role', short: 'no-role' });
      continue;
    }
    const r = checkRule(balances, rule);
    if (r.ok) {
      if (!grantedRoles.includes(role)) grantedRoles.push(role);
    } else {
      deniedRoles.push({ role, reason: r.reason, short: r.short });
    }
  }
  return { grantedRoles, deniedRoles };
}

// highestTier — the single best GRANTED role (highest threshold weight), or null.
export function highestTier(balances, rules) {
  const list = Array.isArray(rules) ? rules : [];
  let best = null;
  let bestWeight = -Infinity;
  for (const rule of list) {
    const role = rule && rule.role != null ? String(rule.role) : '';
    if (!role) continue;
    if (!checkRule(balances, rule).ok) continue;
    const w = ruleWeight(rule);
    if (w > bestWeight) { bestWeight = w; best = role; }
  }
  return best;
}

// renderAccessBadge — one-line, fully esc()'d HTML summary of granted roles.
export function renderAccessBadge(account, result) {
  const acct = esc(account == null ? 'anon' : account);
  const granted = (result && Array.isArray(result.grantedRoles)) ? result.grantedRoles : [];
  if (!granted.length) {
    return `<span class="access-badge none" data-account="${acct}">${acct}: no roles</span>`;
  }
  const roles = granted.map((r) => `<span class="role">${esc(r)}</span>`).join(' ');
  return `<span class="access-badge" data-account="${acct}">${acct}: ${roles}</span>`;
}

// CLI worked example (guarded).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const balances = { VKBT: 250, MELEK: 5 };
  const rules = [
    ...DEFAULT_TIERS,
    { role: 'council', allOf: [{ token: 'VKBT', min: 100 }, { token: 'MELEK', min: 1 }] },
  ];
  const result = evaluateGate({ balances, rules });
  console.log('balances :', balances);
  console.log('granted  :', result.grantedRoles);
  console.log('denied   :', result.deniedRoles);
  console.log('highest  :', highestTier(balances, rules));
  console.log('badge    :', renderAccessBadge('alice', result));
}
