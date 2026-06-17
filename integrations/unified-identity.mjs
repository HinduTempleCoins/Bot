// unified-identity.mjs — ONE identity across both chains (operator 2026-06-17: "use a PRANA address OR a
// MELEK @ on either chain and it Wraps the Token onto the Other one always").
//
// THE DESIGN (three pieces; this module is the off-chain resolver/router — pieces 1+3):
//   1. DETERMINISTIC SHADOW — every MELEK @ has a canonical PRANA address derived from its name
//      (keccak256("melek:"+account)[-20:]), so a @-only user ALWAYS has a PRANA side even before they link a
//      real wallet. (And a 0x-only user always has a 0x; their MELEK side stays null until linked.)
//   2. LINK REGISTRY — explicit @↔0x links a user makes (PM wallet-link in the Discord/Telegram bot). A real
//      linked address OVERRIDES the shadow. Forkable JSON store.
//   3. AUTO-WRAP ROUTER — given EITHER identifier + the token's current chain, decide: deliver locally, or
//      BRIDGE (wrap) to the resolved address on the other chain. The bridge ([[prana-public-infra-live]]) does
//      the actual mint/burn; this just routes.
//
// PURE + soft-fail + injectable keccak (the daemon/bot injects ethers.id; tests inject a stub) + injectable
// registry. No network, no keys. The chain-launch keystone for "one identity, tokens follow you."

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ACCT_RE = /^[a-z][a-z0-9.-]{2,15}$/; // Graphene account names

export function isPranaAddress(s) { return typeof s === 'string' && ADDR_RE.test(s); }
export function isMelekAccount(s) {
  return typeof s === 'string' && ACCT_RE.test(s.trim().replace(/^@+/, '').toLowerCase());
}
export function normMelek(s) { return String(s || '').trim().replace(/^@+/, '').toLowerCase(); }

/** Classify an input as a PRANA address, a MELEK account, or invalid. */
export function classifyId(input) {
  if (isPranaAddress(input)) return 'prana';
  if (isMelekAccount(input)) return 'melek';
  return 'invalid';
}

/**
 * shadowPrana — the deterministic PRANA address for a MELEK account. keccak("melek:"+account) → last 20
 * bytes. Requires an injected keccak (host injects ethers.id; tests inject a deterministic stub). Returns a
 * checksummed-lowercase 0x address, or null on bad input / missing keccak.
 */
export function shadowPrana(account, keccak) {
  const a = normMelek(account);
  if (!ACCT_RE.test(a) || typeof keccak !== 'function') return null;
  let h;
  try { h = String(keccak('melek:' + a)); } catch { return null; }
  const hex = h.replace(/^0x/, '');
  if (hex.length < 40) return null;
  return '0x' + hex.slice(-40).toLowerCase();
}

// ── link registry (explicit @↔0x links; populated by the PM wallet-link) ──────────────────────────────────
/** Normalize a raw registry into {byMelek:{acct:0x}, byPrana:{0x:acct}}. Soft-fails to empty. */
export function indexRegistry(raw = {}) {
  const byMelek = {}, byPrana = {};
  const links = (raw && raw.links) || raw || {};
  for (const [k, v] of Object.entries(links)) {
    const acct = normMelek(k);
    const addr = String(v || '').toLowerCase();
    if (ACCT_RE.test(acct) && ADDR_RE.test(addr)) { byMelek[acct] = addr; byPrana[addr] = acct; }
  }
  return { byMelek, byPrana };
}

/**
 * resolveIdentity — given EITHER a MELEK @ or a PRANA 0x, return both sides.
 *   { kind, melek, prana, pranaIsShadow } — prana falls back to the deterministic shadow for a @-only id
 *   (pranaIsShadow=true); melek stays null for a 0x-only id until that address is linked.
 */
export function resolveIdentity(input, { registry = {}, keccak } = {}) {
  const idx = registry.byMelek ? registry : indexRegistry(registry);
  const kind = classifyId(input);
  if (kind === 'prana') {
    const addr = input.toLowerCase();
    return { kind, prana: addr, melek: idx.byPrana[addr] || null, pranaIsShadow: false };
  }
  if (kind === 'melek') {
    const acct = normMelek(input);
    const linked = idx.byMelek[acct];
    return { kind, melek: acct, prana: linked || shadowPrana(acct, keccak), pranaIsShadow: !linked };
  }
  return { kind: 'invalid', melek: null, prana: null };
}

// ── auto-wrap router ──────────────────────────────────────────────────────────────────────────────────────
// A token lives on a chain ('melek' = the Graphene L1 / engine, 'prana' = the EVM L2). Given a recipient
// identifier + which chain the token is on now, decide whether to deliver locally or bridge (wrap) across.
/**
 * routeTransfer — { action, chain, to, wrap } for sending `token` to `toInput`.
 *   action: 'local' (same chain, direct transfer) | 'bridge' (wrap to the other chain) | 'unresolvable'
 *   chain : the chain the delivery lands on; to: the resolved address/account there; wrap: 'melek->prana'|'prana->melek'|null
 */
export function routeTransfer({ toInput, tokenChain = 'prana', registry = {}, keccak } = {}) {
  const id = resolveIdentity(toInput, { registry, keccak });
  if (id.kind === 'invalid') return { action: 'unresolvable', reason: 'bad-identifier' };

  // The recipient's PREFERRED chain = the chain their identifier is native to.
  const wantChain = id.kind === 'prana' ? 'prana' : 'melek';
  if (wantChain === tokenChain) {
    return { action: 'local', chain: tokenChain, to: tokenChain === 'prana' ? id.prana : id.melek, wrap: null };
  }
  // Cross-chain: wrap the token to the recipient's side. Needs the resolved address on the target chain.
  if (wantChain === 'prana') {
    if (!id.prana) return { action: 'unresolvable', reason: 'no-prana-side' };
    return { action: 'bridge', chain: 'prana', to: id.prana, wrap: 'melek->prana', pranaIsShadow: id.pranaIsShadow };
  }
  // wantChain === 'melek'
  if (!id.melek) return { action: 'unresolvable', reason: 'no-melek-link', note: 'a 0x-only recipient must link a MELEK account to receive on the MELEK chain' };
  return { action: 'bridge', chain: 'melek', to: id.melek, wrap: 'prana->melek' };
}
