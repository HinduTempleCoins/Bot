/**
 * bridge.mjs — the engine-side wMELEK bridge contract (the PROPER, bridge-only
 * mint/burn boundary).
 *
 * THE INVARIANT (hard rule): wMELEK supply MUST always equal MELEK locked in the
 * bridge. wMELEK is minted ONLY when MELEK crosses to the wrapped side (a bridge
 * DEPOSIT) and burned ONLY when it crosses back (a WITHDRAWAL). There is NO free
 * issuance on mainnet.
 *
 * This is the engine MIRROR of the PRANA-side GrapheneDepositBridge: the PRANA
 * WrappedEcosystemToken mints on attested deposit and burns on withdrawal; this
 * contract does the same for the engine's WMELEK side token so the engine's
 * wMELEK supply tracks (deposits − withdrawals) of locked MELEK.
 *
 * AUTH / CONTROL:
 *   - Only `config.bridge.account` may call mintWrapped / burnWrapped. (The
 *     engine.mjs auth table also requires ACTIVE auth for both.)
 *   - The wMELEK token's issuer IS the bridge account (canonical mainnet setup);
 *     this contract auto-creates it that way on first mint if absent.
 *
 * IDEMPOTENCE / REPLAY SAFETY (matches the relayer's depositRef discipline):
 *   - One mint per `depositRef`; a repeat ref is a no-op success (never a double
 *     mint), so re-running the attester/relayer is safe.
 *   - One burn per `withdrawalRef`; likewise.
 *   - An append-only `bridgeLedger` records every mint/burn (audit; the engine
 *     mirror of the relayer's attestation log).
 *
 * SAFETY (matches tokens.mjs / workerbee.mjs §6 B item 4): no user JS, fixed
 * contract logic driven by config. Soft-fail-never-throw; mutations only on
 * ok:true. Throws only on internal invariant violations (engine.mjs catches).
 *
 * Action table (state, ctx, payload) where ctx = { sender, blockNum, blockId, txId, authLevel }:
 *   mintWrapped({ to, amount, depositRef })       bridge-only; mints wMELEK against a deposit ref.
 *   burnWrapped({ from, amount, withdrawalRef })  bridge-only; burns wMELEK on a withdrawal ref.
 *
 * Views (pure reads): lockedSupply, mintedFor, burnedFor.
 */

import { toBaseUnits, fromBaseUnits } from '../lib/decimal.mjs';
import { config } from '../config.mjs';
import { tokens } from './tokens.mjs';

function err(error) {
  return { ok: false, error };
}
function ok(data = {}) {
  return { ok: true, ...data };
}

function getToken(state, symbol) {
  return state.findOne('tokens', { symbol });
}

/** The configured wrapped-MELEK symbol (uppercase). */
function wrappedSymbol() {
  return String(config.bridge.wrappedSymbol || 'WMELEK').toUpperCase();
}

/** Reject anyone but the configured bridge account. */
function bridgeOnly(ctx) {
  const acct = config.bridge.account;
  if (!acct) return err('bridge account not configured');
  if (ctx.sender !== acct) return err(`bridge ops are restricted to the bridge account (${acct})`);
  return null;
}

/**
 * Ensure the wMELEK token exists with the bridge account as issuer. Created
 * deterministically (genesis-style waiver: no APIS fee) the first time the
 * bridge mints. Precision matches the engine wrapper (3 dp, Graphene native).
 */
function ensureWrapped(state, ctx) {
  const symbol = wrappedSymbol();
  let tok = getToken(state, symbol);
  if (tok) return tok;
  // Create with the bridge account as issuer (canonical setup). genesis:true
  // waives the creation fee; the wrappedGuard allows the bridge account anyway.
  const created = tokens.create(
    state,
    { ...ctx, sender: config.bridge.account, genesis: true },
    {
      symbol,
      name: 'Wrapped MELEK',
      precision: 3,
      maxSupply: '9007199254740991',
      supplyCapImmutable: false,
      url: 'https://engine.melek.salon',
    },
  );
  if (!created.ok) throw new Error(`bridge: could not create ${symbol}: ${created.error}`);
  return getToken(state, symbol);
}

export const bridge = {
  /**
   * mintWrapped — mint wMELEK to `to` against a bridge DEPOSIT. Bridge-only,
   * idempotent per `depositRef` (one mint per ref; a repeat is a no-op success).
   * payload: { to, amount, depositRef }
   */
  mintWrapped(state, ctx, p) {
    const blocked = bridgeOnly(ctx);
    if (blocked) return blocked;

    const to = String((p && p.to) || '');
    if (!to) return err('missing recipient (to)');
    const depositRef = String((p && p.depositRef) || '').trim();
    if (!depositRef) return err('missing depositRef');

    // idempotent: one mint per depositRef. Replaying the relayer is safe.
    const prior = state.findOne('bridgeLedger', { kind: 'mint', ref: depositRef });
    if (prior) {
      return ok({ minted: prior.quantity, symbol: wrappedSymbol(), to: prior.account, depositRef, idempotent: true });
    }

    const tok = ensureWrapped(state, ctx);
    let amount;
    try {
      amount = toBaseUnits(String(p && p.amount), tok.precision);
    } catch (e) {
      return err(`bad amount: ${e.message}`);
    }
    if (amount <= 0n) return err('amount must be > 0');

    // Mint via the supply-cap-respecting tokens.issue, signed as the wMELEK issuer
    // (== bridge account). The wrappedGuard passes because sender is the bridge.
    const res = tokens.issue(
      state,
      { ...ctx, sender: tok.issuer },
      { symbol: tok.symbol, to, quantity: fromBaseUnits(amount, tok.precision) },
    );
    if (!res.ok) return res;

    state.insert('bridgeLedger', {
      kind: 'mint',
      ref: depositRef,
      symbol: tok.symbol,
      account: to,
      quantity: fromBaseUnits(amount, tok.precision),
      block: ctx.blockNum,
      txId: ctx.txId,
    });
    return ok({ minted: fromBaseUnits(amount, tok.precision), symbol: tok.symbol, to, depositRef });
  },

  /**
   * burnWrapped — burn wMELEK from `from` on a bridge WITHDRAWAL. Bridge-only,
   * idempotent per `withdrawalRef`. Reduces supply + circulatingSupply so the
   * engine's wMELEK supply tracks (deposits − withdrawals).
   * payload: { from, amount, withdrawalRef }
   */
  burnWrapped(state, ctx, p) {
    const blocked = bridgeOnly(ctx);
    if (blocked) return blocked;

    const from = String((p && p.from) || '');
    if (!from) return err('missing source (from)');
    const withdrawalRef = String((p && p.withdrawalRef) || '').trim();
    if (!withdrawalRef) return err('missing withdrawalRef');

    const prior = state.findOne('bridgeLedger', { kind: 'burn', ref: withdrawalRef });
    if (prior) {
      return ok({ burned: prior.quantity, symbol: wrappedSymbol(), from: prior.account, withdrawalRef, idempotent: true });
    }

    const tok = getToken(state, wrappedSymbol());
    if (!tok) return err(`no such token ${wrappedSymbol()}`);
    let amount;
    try {
      amount = toBaseUnits(String(p && p.amount), tok.precision);
    } catch (e) {
      return err(`bad amount: ${e.message}`);
    }
    if (amount <= 0n) return err('amount must be > 0');

    const row = state.findOne('balances', { account: from, symbol: tok.symbol });
    const liquid = row ? BigInt(row.balance) : 0n;
    if (liquid < amount) return err(`insufficient ${tok.symbol} to burn`);

    row.balance = (liquid - amount).toString();
    tok.supply = (BigInt(tok.supply) - amount).toString();
    tok.circulatingSupply = (BigInt(tok.circulatingSupply) - amount).toString();

    state.insert('bridgeLedger', {
      kind: 'burn',
      ref: withdrawalRef,
      symbol: tok.symbol,
      account: from,
      quantity: fromBaseUnits(amount, tok.precision),
      block: ctx.blockNum,
      txId: ctx.txId,
    });
    return ok({ burned: fromBaseUnits(amount, tok.precision), symbol: tok.symbol, from, withdrawalRef });
  },

  // ── Views (pure reads) ────────────────────────────────────────────────────

  /** lockedSupply — current wMELEK supply (== MELEK that should be locked in the bridge). */
  lockedSupply(state) {
    const tok = getToken(state, wrappedSymbol());
    const prec = tok ? tok.precision : 3;
    return ok({
      symbol: wrappedSymbol(),
      supply: fromBaseUnits(tok ? BigInt(tok.supply) : 0n, prec),
    });
  },

  /** mintedFor — has a depositRef already been minted? Returns the ledger row or null. */
  mintedFor(state, ctx, p) {
    const ref = String((p && p.depositRef) || '').trim();
    return ok({ ref, row: state.findOne('bridgeLedger', { kind: 'mint', ref }) });
  },

  /** burnedFor — has a withdrawalRef already been burned? Returns the ledger row or null. */
  burnedFor(state, ctx, p) {
    const ref = String((p && p.withdrawalRef) || '').trim();
    return ok({ ref, row: state.findOne('bridgeLedger', { kind: 'burn', ref }) });
  },
};

export { ok, err };
