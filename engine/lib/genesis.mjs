/**
 * genesis.mjs — initialise the engine's native tokens before block replay.
 *
 * Creates the APIS (fee) and DRONE (governance) tokens and mints their initial
 * supply to the genesis issuer. Idempotent: if APIS already exists the engine
 * has been bootstrapped, so this is a no-op. Runs with ctx.genesis = true so
 * the creation-fee burn is waived (there is no APIS to pay with yet).
 */

import { tokens } from '../contracts/tokens.mjs';
import { genesis as gcfg } from '../config.mjs';

export function bootstrapGenesis(state) {
  if (state.findOne('tokens', { symbol: gcfg.feeToken })) return false; // already done

  const ctx = {
    sender: gcfg.issuer,
    authLevel: 'active',
    blockNum: 0,
    blockId: 'genesis',
    txId: 'genesis',
    genesis: true,
  };

  for (const t of gcfg.tokens) {
    const created = tokens.create(state, ctx, {
      symbol: t.symbol,
      name: t.name,
      precision: t.precision,
      maxSupply: t.maxSupply,
      url: t.url,
      supplyCapImmutable: t.supplyCapImmutable,
    });
    if (!created.ok) throw new Error(`genesis create ${t.symbol} failed: ${created.error}`);
    // Mint the initial supply ONLY when strictly positive. A zero/absent
    // initialIssue means "create the token, mint nothing" — the mainnet
    // no-pre-mine case (APIS is mined via WorkerBee, not handed out at genesis).
    if (Number(t.initialIssue) > 0) {
      const issued = tokens.issue(state, ctx, {
        symbol: t.symbol,
        to: gcfg.issuer,
        quantity: t.initialIssue,
      });
      if (!issued.ok) throw new Error(`genesis issue ${t.symbol} failed: ${issued.error}`);
    }
  }
  state.meta.genesisIssuer = gcfg.issuer;
  state.meta.genesisDone = true;
  return true;
}
