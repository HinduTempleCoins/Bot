// bridge.mjs — cross-chain interop/bridge routing + safety policy (queue #169) so MELEK/PRANA/SOAP
// can interoperate with outside chains. This is PURE routing + policy: it picks/ranks bridges and
// enforces safety rules. It does NOT bridge anything, hold keys, or touch the network.
//
// WHY THE CAUTION: bridges are the #1 hacked surface in crypto — billions of dollars have been lost
// to bridge exploits (Ronin, Wormhole, Nomad, Harmony Horizon, etc.). The only defensible posture is
// AUDITED / battle-tested bridges only, and MINIMIZE the value at risk in transit. Both rules are
// encoded below: routeQuote() never returns an un-audited bridge, and bridgePolicy() hard-rejects
// un-audited bridges and amounts over a cap.
//
//   import { BRIDGES, routeQuote, bridgePolicy } from './bridge.mjs'
//   node integrations/chains/bridge.mjs

// Curated registry. `audit` is the trust tier we route on:
//   'audited'        — multiple external audits + long battle-tested track record → routable
//   'battle-tested'  — audited and proven at scale → routable (treated as audited for routing)
//   'unaudited'      — NOT routable, NOT allowed by policy (placeholder / unreviewed)
// `risk` is a coarse 1 (lowest) .. 5 (highest) score used only to rank among viable bridges.
// `chains` is the set of chains the bridge can reach; a route is viable iff both endpoints are in it.
export const BRIDGES = [
  {
    id: 'axelar',
    name: 'Axelar',
    audit: 'battle-tested',
    risk: 2,
    kind: 'generalized-message-passing',
    chains: ['MELEK', 'PRANA', 'SOAP', 'ethereum', 'cosmos', 'polygon', 'avalanche', 'arbitrum', 'optimism'],
  },
  {
    id: 'layerzero',
    name: 'LayerZero',
    audit: 'battle-tested',
    risk: 3,
    kind: 'omnichain-messaging',
    chains: ['MELEK', 'PRANA', 'SOAP', 'ethereum', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'bsc'],
  },
  {
    id: 'wormhole',
    name: 'Wormhole',
    audit: 'audited',
    risk: 4, // historic exploit ($325M, 2022); since re-audited/hardened — routable but ranked riskier
    kind: 'generalized-message-passing',
    chains: ['MELEK', 'SOAP', 'ethereum', 'solana', 'polygon', 'avalanche', 'arbitrum'],
  },
  {
    id: 'chainlink-ccip',
    name: 'Chainlink CCIP',
    audit: 'audited',
    risk: 1, // defense-in-depth (risk management network), conservative rollout → lowest risk tier
    kind: 'generalized-message-passing',
    chains: ['MELEK', 'PRANA', 'SOAP', 'ethereum', 'polygon', 'avalanche', 'arbitrum', 'optimism', 'bsc'],
  },
  {
    id: 'cosmos-ibc',
    name: 'Cosmos IBC',
    audit: 'battle-tested',
    risk: 1, // light-client / trust-minimized protocol, years in production → lowest risk tier
    kind: 'light-client',
    chains: ['MELEK', 'PRANA', 'cosmos', 'osmosis', 'juno'],
  },
  {
    id: 'hyperlane',
    name: 'Hyperlane',
    audit: 'audited',
    risk: 3,
    kind: 'permissionless-interchain',
    chains: ['MELEK', 'SOAP', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche'],
  },
];

// trust tiers we are willing to route over. Anything else (notably 'unaudited') is never routed.
const ROUTABLE_AUDIT = new Set(['audited', 'battle-tested']);

// default ceiling on value crossing a bridge at once (minimize value at risk). Caller can override
// via maxBridgedValue; this is the conservative floor used when none is supplied.
export const DEFAULT_MAX_BRIDGED_VALUE = 25_000;

const isRoutable = (b) => b && ROUTABLE_AUDIT.has(b.audit);

// routeQuote — PURE. Given a desired transfer, return the viable bridges ranked best-first.
// "Viable" = audited/battle-tested AND reaches both endpoints AND (if asset given) the chains differ.
// Ranking: lowest risk first; ties broken by fewer supported chains (smaller attack surface), then id.
// Returns [] when there is no audited route (no-route case) — never throws on missing inputs.
export function routeQuote({ fromChain, toChain, asset, amount } = {}) {
  if (!fromChain || !toChain || fromChain === toChain) return [];
  const viable = BRIDGES.filter(
    (b) => isRoutable(b) && b.chains.includes(fromChain) && b.chains.includes(toChain),
  );
  viable.sort(
    (a, b) => a.risk - b.risk || a.chains.length - b.chains.length || a.id.localeCompare(b.id),
  );
  return viable.map((b) => ({
    id: b.id,
    name: b.name,
    audit: b.audit,
    risk: b.risk,
    kind: b.kind,
    fromChain,
    toChain,
    asset: asset || null,
    amount: amount ?? null,
  }));
}

// bridgePolicy — SAFETY GUARD. Decides whether a single bridge transfer is permitted.
// Enforces the two load-bearing rules: (1) audited/battle-tested bridges ONLY — reject everything
// else; (2) minimize bridged value — reject amounts over the cap. `bridge` may be a registry id, a
// registry object, or any object with {audit, name}. Returns {allowed, reason}.
export function bridgePolicy({ amount, bridge, maxBridgedValue } = {}) {
  const cap = Number.isFinite(maxBridgedValue) ? maxBridgedValue : DEFAULT_MAX_BRIDGED_VALUE;

  const b =
    typeof bridge === 'string' ? BRIDGES.find((x) => x.id === bridge || x.name === bridge) : bridge;
  if (!b) return { allowed: false, reason: 'unknown bridge — not in the curated registry' };

  if (!ROUTABLE_AUDIT.has(b.audit)) {
    return { allowed: false, reason: `un-audited bridge (${b.name || b.id}) — audited only; bridges are the #1 hacked surface` };
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { allowed: false, reason: 'invalid or non-positive amount' };
  }
  if (amt > cap) {
    return { allowed: false, reason: `amount ${amt} exceeds cap ${cap} — minimize value at risk in transit` };
  }

  return { allowed: true, reason: `ok — ${b.name || b.id} is ${b.audit}, ${amt} within cap ${cap}` };
}

if (process.argv[1] && process.argv[1].endsWith('bridge.mjs')) {
  const example = { fromChain: 'MELEK', toChain: 'ethereum', asset: 'USDC', amount: 5000 };
  console.log(`Route quote for ${example.amount} ${example.asset} ${example.fromChain} → ${example.toChain}:`);
  const ranked = routeQuote(example);
  if (!ranked.length) console.log('  (no audited route)');
  for (const r of ranked) {
    const pol = bridgePolicy({ amount: example.amount, bridge: r.id });
    console.log(`  • ${r.name.padEnd(16)} audit=${r.audit} risk=${r.risk}  policy=${pol.allowed ? 'ALLOW' : 'DENY'} (${pol.reason})`);
  }
}
