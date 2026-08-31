// adapters.mjs — the EXECUTION-ADAPTER layer. This is the seam where a gated order becomes an actual
// venue call. Every adapter has the SAME contract, so a suggestion from any bot can be executed on any
// venue by the same pipeline. Default posture is STAGED: an adapter BUILDS the exact call it would make
// and returns it as an intent WITHOUT broadcasting. Going live is one explicit, operator-authorized flag
// per adapter — never a default.
//
// Adapter contract:
//   { venue, label, keyless, authGate, supports(order) -> bool, async execute(order, { live }) -> confirmation }
// confirmation: { status: 'STAGED'|'FILLED'|'FAILED', venue, order, call?, txId?, reason }
//   - STAGED  : call built, not sent (this is the default until authorized)
//   - FILLED  : venue reports the value moved (only reachable when live AND the adapter is authorized)
//   - FAILED  : adapter could not build or send the call
//
// keyless=true means the authorized/non-custodial path (Paybox/MoonX signs via the user's granted
// wallet — no WIF on this host). keyless=false means a server-side key is required to go live.
// `authGate` names the ONE env flag that must equal 'true' to leave STAGED.

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const isLive = (name) => process.env[name] === 'true';

function staged(venue, order, call, note) {
  return { status: 'STAGED', venue, order, call: call || null,
    reason: note || 'staged: operator authorization required to broadcast' };
}
function failed(venue, order, reason) { return { status: 'FAILED', venue, order, call: null, reason }; }

// ── Hive-Engine adapter ───────────────────────────────────────────────────────────────────────────
// Live path delegates to the SINGLE existing signing gate: angelicalist/trader.placeOrder (which is
// itself gated on ANGELICALIST_LIVE + WIF). We do NOT re-implement signing here. keyless=false.
export const hiveEngineAdapter = {
  venue: 'hive-engine',
  label: 'Hive-Engine market (via angelicalist signing gate)',
  keyless: false,
  authGate: 'REVENUE_LIVE_HIVE_ENGINE',
  supports: (o) => o?.venue === 'hive-engine' && ['buy', 'sell'].includes(String(o?.side).toLowerCase())
    && num(o?.qty) > 0 && num(o?.price) > 0,
  async execute(order, { live = false } = {}) {
    const call = { module: 'integrations/angelicalist/trader.mjs', fn: 'placeOrder',
      args: { side: String(order.side).toLowerCase(), symbol: order.symbol, quantity: order.qty, price: order.price } };
    if (!live || !isLive(this.authGate)) return staged(this.venue, order, call);
    try {
      const trader = await import('../angelicalist/trader.mjs');
      const r = await trader.placeOrder(call.args);
      // trader returns { simulated:true, ... } when ITS own gate is off — surface that honestly.
      if (r?.simulated) return staged(this.venue, order, call, 'angelicalist trader still in dry-run (ANGELICALIST_LIVE/WIF not set)');
      return { status: 'FILLED', venue: this.venue, order, call, txId: r?.txId || null, reason: 'broadcast via angelicalist trader' };
    } catch (e) { return failed(this.venue, order, e?.message || String(e)); }
  },
};

// ── Paybox / MoonX (Solana) adapter — the KEYLESS, non-custodial authorized path ───────────────────
// This host holds NO wallet key. Execution happens through the Paybox MCP (request_swap), signed by
// the user's granted wallet. So even "live" here does not sign locally — it emits the exact MCP call
// descriptor the runtime/operator invokes. Status stays PENDING_AUTHORIZED_CALL rather than fabricating
// a fill this module cannot actually perform. keyless=true.
export const payboxMoonxAdapter = {
  venue: 'paybox-moonx',
  label: 'Paybox / MoonX Solana swap (non-custodial, keyless)',
  keyless: true,
  authGate: 'REVENUE_LIVE_PAYBOX',
  supports: (o) => o?.venue === 'paybox-moonx' && o?.inputMint && o?.outputMint && num(o?.amount) > 0,
  async execute(order, { live = false } = {}) {
    // Solana rule: mint addresses, never symbols; "native" for SOL. Enforced by requiring explicit mints.
    const call = { tool: 'mcp__claude_ai_Paybox__request_swap',
      input: { inputMint: order.inputMint, outputMint: order.outputMint, amount: String(order.amount),
        slippageBps: num(order.slippageBps) > 0 ? +order.slippageBps : 100 } };
    if (!live || !isLive(this.authGate)) return staged(this.venue, order, call);
    // Even authorized, this module cannot call MCP tools directly — hand the runtime the exact call.
    return { status: 'STAGED', venue: this.venue, order, call,
      reason: 'authorized keyless path: runtime must invoke request_swap (passkey approval may apply)' };
  },
};

// ── CEX (ccxt) adapter — server-side exchange keys; live requires them present ──────────────────────
export const ccxtCexAdapter = {
  venue: 'cex',
  label: 'CEX spot order (ccxt)',
  keyless: false,
  authGate: 'REVENUE_LIVE_CEX',
  supports: (o) => o?.venue === 'cex' && o?.exchange && ['buy', 'sell'].includes(String(o?.side).toLowerCase())
    && num(o?.qty) > 0,
  async execute(order, { live = false } = {}) {
    const call = { lib: 'ccxt', exchange: order.exchange, method: 'createOrder',
      args: { symbol: order.symbol, type: order.type || 'limit', side: String(order.side).toLowerCase(),
        amount: order.qty, price: order.price ?? null } };
    if (!live || !isLive(this.authGate)) return staged(this.venue, order, call);
    // Keys are intentionally NOT wired into this build — going live on a CEX is a separate, explicit step.
    return staged(this.venue, order, call, 'CEX live path not wired in this build (exchange keys deliberately absent)');
  },
};

export const DEFAULT_ADAPTERS = Object.freeze([hiveEngineAdapter, payboxMoonxAdapter, ccxtCexAdapter]);

/** Pick the first adapter that supports the order. Returns null if none (order is then unroutable). */
export function pickAdapter(order, registry = DEFAULT_ADAPTERS) {
  for (const a of registry) { try { if (a.supports(order)) return a; } catch {} }
  return null;
}

/** Snapshot of adapter readiness — what would actually broadcast if the pipeline ran live right now. */
export function adapterStatus(registry = DEFAULT_ADAPTERS) {
  return registry.map((a) => ({ venue: a.venue, label: a.label, keyless: a.keyless,
    authGate: a.authGate, authorized: isLive(a.authGate) }));
}

export default { hiveEngineAdapter, payboxMoonxAdapter, ccxtCexAdapter, DEFAULT_ADAPTERS, pickAdapter, adapterStatus };
