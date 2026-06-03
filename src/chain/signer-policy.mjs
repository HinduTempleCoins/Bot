// signer-policy.mjs — the MELEK-Signer policy engine, as a pure tested module (PRE-SIGNER 4).
//
// MELEK_SIGNER.md §3c: "Every incoming request runs through a policy checker
// *before* the key sees it." This module IS that checker, factored out so it can
// be built and proven offline — before the private melek-signer repo exists — and
// then lifted verbatim into MELEK-Signer's Node runtime.
//
// It returns the exact hook shape createMockSigner() in melek-signer-client.mjs
// already calls:
//
//   policy: (ops, tokenInfo) => Promise<{ ok: boolean, reason?: string }>
//
// The seven §3c/§7 rules, enforced strictly in this order (first failure wins):
//   1. Op-kind allowlist per token scope (transfer-only for the signup token).
//   2. Recipient account age — created within the last 24h (injectable chain lookup).
//   3. Amount band — strictly within [5.000, 15.000] MELEK (config-stubbed,
//      fixedAmount-vs-tiered per §7 open decision #6).
//   4. Per-recipient lifetime cap — ONE grant per `to` account, ever (injectable store).
//   5. Per-day sliding-window cap — config N, default 100 (§3c / §7 open decision #5).
//   6. Append-only audit entry for every accept AND reject (injectable sink, §3c).
//
// Purity contract: NO Date.now() / new Date() inside any decision path without an
// injected clock. createPolicy({ clock }) is the only source of "now". Storage,
// chain lookup, and audit sink are all injected. Same inputs → same verdict.
//
//   import { createPolicy } from './signer-policy.mjs';
//   const policy = createPolicy({
//     clock: () => Date.now(),
//     chain: { accountAgeMs: async (name) => ... },
//     store: makeMemoryStore(),
//     audit: (entry) => appendToFile(entry),
//   });
//   const verdict = await policy(ops, tokenInfo);   // { ok, reason? }

// ── asset parsing ────────────────────────────────────────────────────────────
//
// Graphene/MELEK transfer amounts are 3-decimal asset strings: "10.000 MELEK".
// We parse to integer "milli-units" (×1000) so the band comparison is exact —
// never compare these as floats.

const SYMBOL = 'MELEK';
const PRECISION = 3;
const SCALE = 10 ** PRECISION; // 1000 milli-units per MELEK

/**
 * Parse a MELEK asset string ("12.500 MELEK") to integer milli-units (12500).
 * Returns { ok:true, milli } or { ok:false, reason }. Strict: requires the MELEK
 * symbol and exactly PRECISION decimals (matches how transfers are formatted
 * elsewhere in the repo — feed-publisher.js, register.js use "X.000 MELEK").
 */
export function parseMelek(amount) {
  if (typeof amount !== 'string') return { ok: false, reason: 'amount must be a string asset' };
  const m = /^(\d+)\.(\d{3})\s+([A-Z]+)$/.exec(amount.trim());
  if (!m) return { ok: false, reason: `malformed amount '${amount}' (expected "N.NNN MELEK")` };
  const [, whole, frac, sym] = m;
  if (sym !== SYMBOL) return { ok: false, reason: `wrong asset '${sym}' (only ${SYMBOL} allowed)` };
  const milli = Number(whole) * SCALE + Number(frac);
  if (!Number.isSafeInteger(milli)) return { ok: false, reason: 'amount out of safe range' };
  return { ok: true, milli };
}

/** Format integer milli-units back to a MELEK asset string (for audit summaries). */
export function formatMelek(milli) {
  const whole = Math.floor(milli / SCALE);
  const frac = String(milli % SCALE).padStart(PRECISION, '0');
  return `${whole}.${frac} ${SYMBOL}`;
}

// ── in-memory store (the contract a persistent store must implement) ──────────
//
// Two responsibilities, both injectable so the real signer can back them with a
// durable file/db:
//   • lifetime cap: has this `to` account EVER received a grant?  (granted/markGranted)
//   • per-day window: timestamps of recent grants, for the sliding-window count.
// markGranted is only ever called by the policy on a fully-accepted request.

export function makeMemoryStore() {
  const lifetime = new Set();      // `to` accounts that have ever been granted
  const grantTimes = [];           // epoch-ms of each granted request (ascending-ish)
  return {
    granted(to) { return lifetime.has(to); },
    markGranted(to, atMs) {
      lifetime.add(to);
      grantTimes.push(atMs);
    },
    // count grants strictly within (sinceMs, nowMs] — the sliding window.
    countSince(sinceMs) {
      let n = 0;
      for (const t of grantTimes) if (t > sinceMs) n += 1;
      return n;
    },
  };
}

// ── default config (the §7 open decisions, stubbed so the operator can flip them) ──

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_CONFIG = Object.freeze({
  // §3c op-kind whitelist. The signup token may ONLY request these kinds.
  // (createMockSigner also scope-checks; this is the policy-layer belt to its braces.)
  allowedOps: ['transfer'],

  // §3c amount band, in MELEK (inclusive). Held as numbers; converted to
  // milli-units at construction so comparisons stay integer-exact.
  amountBand: { minMelek: 5.0, maxMelek: 15.0 },

  // §7 open decision #6 — fixed vs tiered grant amount.
  //   mode: 'fixedAmount' → every grant must equal `fixedMelek` (default 10.000).
  //   mode: 'tiered'      → any amount inside the band is allowed (tutorial-progress
  //                         tiering is resolved upstream; policy just enforces the band).
  // Operator picks. Default 'fixedAmount' is the tighter, drain-bounding choice.
  amount: { mode: 'fixedAmount', fixedMelek: 10.0 },

  // §3c recipient age — account creation block within the last 24h.
  maxAccountAgeMs: DAY_MS,

  // §3c / §7 open decision #5 — per-day sliding-window cap.
  perDayCap: 100,
  windowMs: DAY_MS,

  // Hathor's own account name — the only legitimate `from` for a signup grant.
  // null = don't enforce a specific sender (any from passes the from-check).
  fromAccount: 'hathor',
});

// ── policy factory ────────────────────────────────────────────────────────────

/**
 * Build the policy hook.
 *
 *  config — partial override of DEFAULT_CONFIG (deep-ish: nested objects merged).
 *  clock  — () => epoch-ms. REQUIRED for any time-dependent decision (age, window).
 *           No internal Date.now() fallback in decision paths — inject it.
 *  chain  — { accountAgeMs(name): Promise<number|null> } — ms since the recipient's
 *           creation block. null/undefined ⇒ unknown ⇒ rejected (fail closed).
 *  store  — { granted(to), markGranted(to, atMs), countSince(sinceMs) }.
 *  audit  — (entry) => void|Promise — append-only sink. Called for EVERY verdict.
 *
 * Returns: async (ops, tokenInfo) => { ok, reason? }
 */
export function createPolicy({ config = {}, clock, chain, store, audit } = {}) {
  if (typeof clock !== 'function') {
    throw new Error('signer-policy: clock injection required (no Date.now() in decision paths)');
  }
  if (!chain || typeof chain.accountAgeMs !== 'function') {
    throw new Error('signer-policy: chain.accountAgeMs(name) injection required');
  }
  if (!store || typeof store.granted !== 'function' || typeof store.markGranted !== 'function' || typeof store.countSince !== 'function') {
    throw new Error('signer-policy: store {granted, markGranted, countSince} injection required');
  }
  const auditSink = typeof audit === 'function' ? audit : () => {};

  // Merge config (one level of nesting for amountBand / amount).
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
    amountBand: { ...DEFAULT_CONFIG.amountBand, ...(config.amountBand || {}) },
    amount: { ...DEFAULT_CONFIG.amount, ...(config.amount || {}) },
  };
  const minMilli = Math.round(cfg.amountBand.minMelek * SCALE);
  const maxMilli = Math.round(cfg.amountBand.maxMelek * SCALE);
  const fixedMilli = Math.round((cfg.amount.fixedMelek ?? 10.0) * SCALE);

  /** ops-summary for the audit log — never includes keys/tokens, just shape. */
  function summarize(ops) {
    if (!Array.isArray(ops)) return [];
    return ops.map((op) => {
      const kind = Array.isArray(op) ? op[0] : undefined;
      const p = (Array.isArray(op) && op[1]) || {};
      if (kind === 'transfer') {
        return { kind, from: p.from, to: p.to, amount: p.amount };
      }
      return { kind };
    });
  }

  /** Emit an audit entry and return the verdict it describes. */
  async function settle(decision, reason, ops, tokenInfo) {
    const entry = {
      at: clock(),
      decision,                         // 'accept' | 'reject'
      reason: reason || null,           // null on accept
      ops: summarize(ops),
      clientRef: (tokenInfo && tokenInfo.clientRef) || null,
      token: (tokenInfo && (tokenInfo.name || tokenInfo.id)) || null, // name only, never a secret
    };
    await auditSink(entry);
    return decision === 'accept' ? { ok: true } : { ok: false, reason };
  }

  return async function policy(ops, tokenInfo = {}) {
    // Structural guard — ops must be a non-empty op list.
    if (!Array.isArray(ops) || ops.length === 0) {
      return settle('reject', 'ops must be a non-empty array', ops, tokenInfo);
    }

    // ── Rule 1: op-kind allowlist per token scope ────────────────────────────
    // Token scope (if present) further narrows the policy allowlist. The signup
    // token's scope is ['transfer']; the intersection is what we permit.
    const scoped = Array.isArray(tokenInfo.scopes) ? tokenInfo.scopes : null;
    const allowed = scoped
      ? cfg.allowedOps.filter((k) => scoped.includes(k))
      : cfg.allowedOps;
    for (const op of ops) {
      const kind = Array.isArray(op) ? op[0] : undefined;
      if (!allowed.includes(kind)) {
        return settle('reject', `op '${kind}' not permitted by policy (allowed: ${allowed.join(', ') || 'none'})`, ops, tokenInfo);
      }
    }

    // A signup-grant request is exactly one transfer. The remaining rules are
    // transfer-specific; a multi-op bundle is outside the signup-grant envelope.
    if (ops.length !== 1) {
      return settle('reject', `signup-grant policy expects a single transfer op, got ${ops.length}`, ops, tokenInfo);
    }
    const [, payload] = ops[0];
    const to = payload && payload.to;
    const from = payload && payload.from;
    if (!to || typeof to !== 'string') {
      return settle('reject', 'transfer missing recipient (to)', ops, tokenInfo);
    }
    if (cfg.fromAccount && from !== cfg.fromAccount) {
      return settle('reject', `transfer 'from' must be ${cfg.fromAccount}, got ${from || '(none)'}`, ops, tokenInfo);
    }

    // ── Rule 3 (parse early; needed before any side-effect): amount band ──────
    const parsed = parseMelek(payload.amount);
    if (!parsed.ok) {
      return settle('reject', parsed.reason, ops, tokenInfo);
    }
    if (parsed.milli < minMilli || parsed.milli > maxMilli) {
      return settle('reject',
        `amount ${formatMelek(parsed.milli)} outside band [${formatMelek(minMilli)}, ${formatMelek(maxMilli)}]`,
        ops, tokenInfo);
    }
    if (cfg.amount.mode === 'fixedAmount' && parsed.milli !== fixedMilli) {
      return settle('reject',
        `amount ${formatMelek(parsed.milli)} != fixed grant ${formatMelek(fixedMilli)} (mode=fixedAmount)`,
        ops, tokenInfo);
    }

    // ── Rule 2: recipient account age (chain lookup, fail-closed) ─────────────
    let ageMs;
    try {
      ageMs = await chain.accountAgeMs(to);
    } catch (e) {
      return settle('reject', `recipient age lookup failed for ${to}`, ops, tokenInfo);
    }
    if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) {
      return settle('reject', `recipient ${to} age unknown — refused (fail closed)`, ops, tokenInfo);
    }
    if (ageMs > cfg.maxAccountAgeMs) {
      return settle('reject',
        `recipient ${to} too old (${Math.round(ageMs / 1000)}s > ${Math.round(cfg.maxAccountAgeMs / 1000)}s) — grants are signup-only`,
        ops, tokenInfo);
    }

    // ── Rule 4: per-recipient lifetime cap (ONE grant per `to`, ever) ─────────
    if (store.granted(to)) {
      return settle('reject', `recipient ${to} already received a signup grant (one per account, ever)`, ops, tokenInfo);
    }

    // ── Rule 5: per-day sliding-window cap ───────────────────────────────────
    const now = clock();
    const used = store.countSince(now - cfg.windowMs);
    if (used >= cfg.perDayCap) {
      return settle('reject', `per-day grant cap reached (${used}/${cfg.perDayCap} in the last ${Math.round(cfg.windowMs / 3600000)}h)`, ops, tokenInfo);
    }

    // ── Accept: record the grant (lifetime + window) then audit-accept ───────
    store.markGranted(to, now);
    return settle('accept', null, ops, tokenInfo);
  };
}
