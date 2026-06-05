/**
 * seams.mjs — the two gated PRANA-DEX seams (security study §7).
 *
 * Melek-Engine runs NO DEX. It owns tokens, balances, transfers, and pegged-
 * asset mint/burn bookkeeping. PRANA (later) owns price discovery, order
 * matching, and AMM. They meet at exactly two interfaces, both implemented
 * here as registered, revocable, rate-limited capability contracts — and both
 * DISABLED by config until PRANA exists. The code path is present so the
 * boundary is real and testable, but every action short-circuits to a
 * "seam disabled" error while `config.seams.<name>.enabled === false`.
 *
 * Seam 1 — gateway (pegged-asset deposit/withdraw bookkeeping):
 *   deposit:  a registered gateway account attests foreign value arrived ->
 *             engine mints a pegged token to the user. (mint-on-attested-deposit)
 *   withdraw: user burns a pegged token -> engine records a withdraw intent the
 *             gateway fulfils off-engine. (burn-on-withdraw)
 *   The engine NEVER holds foreign keys or custody. Mirrors SWAP.HIVE.
 *
 * Seam 2 — dexSettlement (signed-fill settlement/escrow primitive):
 *   The engine verifies a fill receipt signed by the registered DEX account
 *   and moves engine tokens to settle a trade matched on PRANA. The engine
 *   never holds an orderbook or computes a match price.
 */

import { config } from '../config.mjs';

function err(error) {
  return { ok: false, error };
}
function ok(data = {}) {
  return { ok: true, ...data };
}

function seamGuard(name, ctx) {
  const seam = config.seams[name];
  if (!seam || !seam.enabled) {
    return err(`seam "${name}" is disabled (no DEX on engine; gated for PRANA)`);
  }
  // capability registration + scoping (§7 item 5): only registered accounts.
  if (!seam.registeredAccounts.includes(ctx.sender)) {
    return err(`account ${ctx.sender} is not a registered ${name} capability account`);
  }
  return null;
}

export const gateway = {
  /** deposit: registered gateway mints a pegged token for a user. */
  deposit(state, ctx, _p) {
    const blocked = seamGuard('gateway', ctx);
    if (blocked) return blocked;
    // Implementation lands when PRANA gateway accounts are registered.
    return err('gateway.deposit not yet implemented (seam reserved for PRANA)');
  },
  /** withdraw: user burns a pegged token; gateway fulfils off-engine. */
  withdraw(state, ctx, _p) {
    const blocked = seamGuard('gateway', ctx);
    if (blocked) return blocked;
    return err('gateway.withdraw not yet implemented (seam reserved for PRANA)');
  },
};

export const dexSettlement = {
  /** settle: verify a signed fill receipt from the registered DEX, move tokens. */
  settle(state, ctx, _p) {
    const blocked = seamGuard('dexSettlement', ctx);
    if (blocked) return blocked;
    return err('dexSettlement.settle not yet implemented (seam reserved for PRANA)');
  },
};

export { ok, err };
