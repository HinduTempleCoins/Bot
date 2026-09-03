// soulava-token.mjs — SOULAVA (SOUL): the delegation-mining reward token, a PRANA (EVM) ERC-20.
//
// SOULAVA is a PRANA token (operator: "SOULAVA is a PRANA token"), the kula-ring counterpart to MWALI —
// which is also a PRANA/KulaSwap token (the Proof-of-Liquidity gauge reward). So the ring lives on PRANA's
// DeFi side: MWALI for liquidity, SOULAVA for delegation. In the ring a valuable is never kept — it is
// passed on, and the standing lies in the giving. That is delegation: lend your weight to @hathor and mine
// SOUL for the giving.
//
// THE CROSS-CHAIN SHAPE: delegation happens on MELEK (you delegate MELEK vests / a SCOT stake to @hathor).
// The off-chain accounting in delegation-program.mjs computes each delegator's earned SOUL. A trusted keeper
// then MINTS SOULAVA on PRANA to each delegator's PRANA address (a mintable ERC-20 with MINTER_ROLE held by
// a distributor — modeled on kulaswap/contracts/src/MwaliPoLGauge.sol, the MWALI minter). This module is the
// token descriptor + the mint-plan builder; it holds no keys and sends nothing (the keeper/relayer executes).
//
//   import * as soul from './soulava-token.mjs'

import { PROGRAM } from './delegation-program.mjs';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export const SOULAVA = Object.freeze({
  name: process.env.SOULAVA_NAME || 'SOULAVA',
  symbol: process.env.DELEGATION_TOKEN || PROGRAM.token || 'SOULA',
  decimals: 18,                                             // EVM standard (matches KULA/MWALI on PRANA)
  chain: 'PRANA',
  maxSupply: process.env.SOULAVA_MAX_SUPPLY || '100000000', // 100M cap
  pairsWith: 'MWALI',
  role: 'delegation-mining reward',
  // On-chain wiring (filled once deployed on PRANA; overridable for a host swap, like kula-config-addresses).
  token: process.env.SOULAVA_TOKEN_ADDR || '',            // the ERC-20
  distributor: process.env.SOULAVA_DISTRIBUTOR_ADDR || '', // holds MINTER_ROLE; the keeper calls it
});

const WEI = 10n ** 18n;
/** Convert a SOUL amount (float, 6dp accounting) to base units (wei) as a BigInt. */
export function toWei(amountSoul) {
  const micro = BigInt(Math.round(round6(num(amountSoul)) * 1e6));  // 6dp → integer micro-SOUL
  return (micro * WEI) / 1_000_000n;
}

/** The distributor.mint(to, amount) call descriptor for one delegator. */
export function mintCall(toAddress, amountSoul) {
  return { to: SOULAVA.distributor || '<distributor>', fn: 'mint', args: [toAddress, toWei(amountSoul).toString()],
    token: SOULAVA.symbol, human: `mint ${round6(num(amountSoul))} ${SOULAVA.symbol} → ${toAddress}` };
}

/**
 * Build the PRANA mint plan from the off-chain delegation ledger: for each delegator with earned SOUL,
 * a mint call to their PRANA address. `resolveAddress(melekAccount)` → PRANA address (injected — a REN/
 * registry lookup); delegators without a resolved address are returned in `unresolved`, never minted to 0x0.
 * @param {object} ledger  from delegation-program.ledger() — { delegators:[{account, earned}] }
 * @param {(account:string)=>string|null} resolveAddress
 */
export function distributionPlan(ledger, resolveAddress) {
  const dels = (ledger && ledger.delegators) || [];
  const mints = []; const unresolved = [];
  for (const d of dels) {
    const earned = round6(num(d.earned));
    if (earned <= 0) continue;
    const addr = (typeof resolveAddress === 'function' ? resolveAddress(d.account) : null);
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(String(addr))) { unresolved.push({ account: d.account, earned }); continue; }
    mints.push({ account: d.account, ...mintCall(addr, earned) });
  }
  return { token: SOULAVA.symbol, chain: SOULAVA.chain, mints, unresolved };
}

/** The announcement post (markdown) — SOULAVA on PRANA. Honest status (design until minted). */
export function announcement({ pool = PROGRAM.pool, minted = false } = {}) {
  const status = minted
    ? `**${SOULAVA.symbol} is live** on PRANA.`
    : `**${SOULAVA.symbol} is not minted yet** — this is the design, published so you can see how it will work.`;
  return `# Introducing ${SOULAVA.name} (${SOULAVA.symbol}) — earn by lending your weight

${status}

In the kula ring, a valuable is never kept. The **soulava** necklace is passed hand to hand around the
islands, and the honor belongs not to whoever holds it but to whoever *gives* it onward. ${SOULAVA.name} is
that idea as a token: **delegate your standing to @${pool}, and you mine ${SOULAVA.symbol} for the giving.**

## How to earn it
1. **Delegate** MELEK vesting shares — or a MELEK-Engine SCOT-token stake — to @${pool}.
2. You mine **${SOULAVA.symbol}** continuously, in proportion to your share of the pool. It is minted to your
   **PRANA** address (${SOULAVA.symbol} is a PRANA token, so it trades on KulaSwap beside its pair, MWALI).
3. You also receive **a share of everything the pool earns** — MELEK and other tokens — paid out pro-rata
   (the operator keeps a small cut to run it).
4. Holding ${SOULAVA.symbol} lets you **direct @${pool}'s votes** — a Pizza-Bot-style callable vote.
5. It's a **loan of standing, not a gift** — undelegate whenever you wish.

*MWALI is minted for liquidity; ${SOULAVA.symbol} for delegation. The two kula valuables, circling PRANA.*`;
}

/** A one-line honest status for a HUD / registry. */
export function status({ minted = false } = {}) {
  return { name: SOULAVA.name, symbol: SOULAVA.symbol, kind: 'ERC-20', chain: 'PRANA',
    status: minted ? 'live' : 'design', pairsWith: 'MWALI', role: SOULAVA.role };
}
