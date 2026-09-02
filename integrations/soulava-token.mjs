// soulava-token.mjs — SOULAVA (SOUL): the delegation-mining token, defined as a real MELEK-Engine SCOT
// token, plus its announcement. This is the "make one and announce it so people see how SCOT tokens work"
// piece — SOULAVA doubles as the worked example of a stakeable/delegatable SCOT token.
//
// SOULAVA is the kula-ring counterpart to MWALI (our Proof-of-Liquidity reward): the necklaces to the
// armbands. In the ring, a valuable is never kept — it is passed on, and the standing lies in the giving.
// That is delegation: lend your weight to @hathor, and you mine SOUL for the giving.
//
// The token SPEC is built through the engine's own buildTokenSpec() (so it's a genuine SCOT spec, not a
// mock). NAME IS NOT YET LOCKED — symbol/name are config so the operator can rename before mint; nothing
// here mints or broadcasts. Pure, offline-tested.
//
//   import * as soul from './soulava-token.mjs'

import { buildTokenSpec } from '../engine/lib/smt-token-spec.mjs';
import { PROGRAM } from './delegation-program.mjs';

export const SOULAVA = Object.freeze({
  name: process.env.SOULAVA_NAME || 'SOULAVA',
  symbol: process.env.DELEGATION_TOKEN || PROGRAM.token || 'SOUL',
  precision: 3,
  maxSupply: process.env.SOULAVA_MAX_SUPPLY || '100000000',   // 100M
  inflationPerDay: String(PROGRAM.emissionPerDay || 1000),
  tags: ['soulava', 'delegation', 'hathor', 'kula'],
  // A SCOT token earns author/curator on its posts too — 65/35 per token-philosophy-real-utility.
  authorCuratorSplit: 65,
});

/** The SCOT token spec, validated by the engine's builder. { ok, spec, errors }. */
export function soulavaSpec(overrides = {}) {
  return buildTokenSpec({
    symbol: SOULAVA.symbol, precision: SOULAVA.precision, maxSupply: SOULAVA.maxSupply,
    tags: SOULAVA.tags, authorCuratorSplit: SOULAVA.authorCuratorSplit, inflationPerDay: SOULAVA.inflationPerDay,
    ...overrides,
  });
}

/**
 * The announcement post (markdown) — explains SOULAVA + how the delegation program + SCOT staking work, so
 * readers learn the mechanism from a live example. Honest status: it is a DESIGN until minted/announced.
 */
export function announcement({ pool = PROGRAM.pool, minted = false } = {}) {
  const status = minted
    ? `**${SOULAVA.symbol} is live** on MELEK-Engine.`
    : `**${SOULAVA.symbol} is not minted yet** — this is the design, published so you can see how it will work.`;
  return `# Introducing ${SOULAVA.name} (${SOULAVA.symbol}) — earn by lending your weight

${status}

In the kula ring, a valuable is never kept. The **soulava** necklace is passed hand to hand around the
islands, and the honor belongs not to whoever holds it but to whoever *gives* it onward. ${SOULAVA.name} is
that idea as a token: **delegate your standing to @${pool}, and you mine ${SOULAVA.symbol} for the giving.**

## How to earn it
1. **Delegate** MELEK vesting shares — or a MELEK-Engine **SCOT-token** stake — to @${pool}.
2. You begin **mining ${SOULAVA.symbol}**, minted to you continuously in proportion to your share of the pool.
3. You also receive **a share of everything the pool earns** — MELEK and other tokens — paid out pro-rata
   (the operator keeps a small cut to run it).
4. Holding ${SOULAVA.symbol} lets you **direct @${pool}'s votes** (\`!vote @author/permlink\`), your weight
   scaled by your share — a Pizza-Bot-style callable vote.
5. It's a **loan of standing, not a gift** — undelegate whenever you wish.

## What ${SOULAVA.symbol} also shows you
${SOULAVA.symbol} is a **SCOT token** (Smart Contracts On Tokens) on MELEK-Engine — its own supply, its own
author/curator rewards (${SOULAVA.authorCuratorSplit}/${100 - SOULAVA.authorCuratorSplit}), its own staking.
Watching it work is watching how *any* MELEK-Engine token works: mint, stake, delegate, earn.

*The ring turns. Lend your weight, and share in what it carries.*`;
}

/** A one-line honest status for a HUD / registry. */
export function status({ minted = false } = {}) {
  return { name: SOULAVA.name, symbol: SOULAVA.symbol, kind: 'SCOT', chain: 'MELEK-Engine',
    status: minted ? 'live' : 'design', pairsWith: 'MWALI', role: 'delegation-mining reward' };
}
