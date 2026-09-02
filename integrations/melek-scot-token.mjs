// melek-scot-token.mjs — a MELEK-Engine SCOT-Bot token that DISTRIBUTES ALONGSIDE MELEK.
//
// The operator's ask (distinct from SOULAVA, which is a PRANA token): a SCOT token on MELEK-Engine that
// pays out on posts **alongside MELEK's own rewards**, with **NO hashtag/tag required** — normal tribe SCOT
// only rewards posts carrying its tag; ours rewards by STAKE across all posts, no tag needed. And **Hathor
// stakes it** to be the founding curator.
//
// So: create the SCOT token WITHOUT a tag (universal distribution), then Hathor stakes a founder allocation
// so her vote carries it. Built on the engine's buildCreateTribeOp / buildEngineOp — real ops, ready to
// broadcast via the Signer (custom_json, SOCIAL tier). Holds no keys, mints nothing here.
//
// NAME IS PROVISIONAL — symbol/name are config; operator to lock (default HALO: angelic MELEK, a halo over
// ALL posts, no tag). Nothing here broadcasts, so the name can change before mint.
//
//   import * as scot from './melek-scot-token.mjs'

import { buildCreateTribeOp, buildScotMintOp } from '../engine/lib/scot-mint.mjs';
import { buildEngineOp } from '../engine/lib/op-builder.mjs';

const BLOCKS_PER_DAY = Number(process.env.MELEK_BLOCKS_PER_DAY || 21600);   // ~4s blocks

export const MELEK_SCOT = Object.freeze({
  // FIAT — the descriptive-ironic name (operator): a joke, because it's NOT completely fiat — unlike real
  // fiat it has a cap, a disclosed mint rate, and utility. The launch post uses it to teach how any currency
  // gets value (specs, scarcity, inflation) vs. why real fiat has none.
  name: process.env.MELEK_SCOT_NAME || 'FIAT',
  symbol: process.env.MELEK_SCOT_SYMBOL || 'FIAT',
  precision: 8,                                          // matches the operator's HE tokens (CURE/VKBT precision 8)
  chain: 'MELEK-Engine',
  // Rarity positioned deliberately BETWEEN the operator's two HE tokens (real Hive-Engine caps, 2026-09-02):
  // CURE max 20,000,000 (rarer) < FIAT 100,000,000 < VKBT max 500,000,000 (less rare). 100M ≈ geometric mid.
  maxSupply: process.env.MELEK_SCOT_MAX_SUPPLY || '100000000',
  emissionPerWindow: process.env.MELEK_SCOT_EMISSION || '1000',
  windowBlocks: BLOCKS_PER_DAY,
  authorBps: 6500,                                        // 65/35 author/curator (token-philosophy)
  // NO tag → universal: distributes on ALL posts by stake, alongside MELEK (not gated to a hashtag).
  universal: true,
  issuer: (process.env.MELEK_SCOT_ISSUER || 'hathor').toLowerCase(),
  // Hathor gets ALL of it to start: the full founder issue goes to her, she stakes it, and distributes from
  // there — so she seeds distribution and earns the curation emission first (until others acquire + stake).
  founderIssue: process.env.MELEK_SCOT_FOUNDER_ISSUE || '100000000',
});

/**
 * The createTribe op — create the token + Scot Bot + founder issue, in one custom_json. Crucially, NO `tag`
 * is set, so the Scot Bot rewards posts universally (by stake), alongside MELEK. Ready for the Signer.
 */
export function createOp(account = MELEK_SCOT.issuer, overrides = {}) {
  return buildCreateTribeOp(account, {
    symbol: MELEK_SCOT.symbol, name: MELEK_SCOT.name, precision: MELEK_SCOT.precision, maxSupply: MELEK_SCOT.maxSupply,
    emissionPerWindow: MELEK_SCOT.emissionPerWindow, windowBlocks: MELEK_SCOT.windowBlocks,
    authorBps: MELEK_SCOT.authorBps, curve: 'linear',
    // deliberately NO `tag` — universal distribution, no hashtag needed
    initialIssue: overrides.initialIssue != null ? overrides.initialIssue : MELEK_SCOT.founderIssue,  // Hathor gets it all
    url: 'https://melek.salon/@' + (account || MELEK_SCOT.issuer),
    ...overrides,
  });
}

/** Hathor STAKES `quantity` of the token so her vote carries it — the founding curator. */
export function hathorStakeOp(quantity, account = MELEK_SCOT.issuer) {
  return buildEngineOp('stake', { symbol: MELEK_SCOT.symbol, quantity: String(quantity) }, account);
}

/** Issue more of the token to an account (issuer-only). */
export function issueOp(to, quantity, account = MELEK_SCOT.issuer) {
  return buildScotMintOp(account, { symbol: MELEK_SCOT.symbol, to, quantity });
}

/** The launch bundle: create (Hathor gets it all) → Hathor stakes the whole allocation → announcement. */
export function launchBundle({ account = MELEK_SCOT.issuer, stakeAmount = MELEK_SCOT.founderIssue } = {}) {
  return { token: status(), create: createOp(account), hathorStake: hathorStakeOp(stakeAmount, account),
    announcement: announcement({ issuer: account }) };
}

/** The announcement — explains the no-tag, stake-to-earn-alongside-MELEK model. Honest status. */
export function announcement({ issuer = MELEK_SCOT.issuer, minted = false } = {}) {
  const s = minted ? `**${MELEK_SCOT.symbol} is live** on MELEK-Engine.`
    : `**${MELEK_SCOT.symbol} is not minted yet** — this is the design.`;
  return `# ${MELEK_SCOT.name} (${MELEK_SCOT.symbol}) — a second reward on every MELEK post

${s}

${MELEK_SCOT.symbol} is a MELEK-Engine SCOT token that pays out **alongside MELEK** — every post can earn
${MELEK_SCOT.symbol} as well as MELEK. Unlike an ordinary tribe token, **there is no hashtag to remember**:
${MELEK_SCOT.symbol} distributes across posts by **stake**, not by tag. Stake ${MELEK_SCOT.symbol}, and your
vote carries it to whatever you curate.

- **No tag needed** — it rewards the whole chain, not one community's posts.
- **Stake to curate** — staked ${MELEK_SCOT.symbol} is your voting weight for the ${MELEK_SCOT.symbol} pool.
- **@${issuer} stakes it** as the founding curator, so the reward flows from the start.
- It also earns author/curator on its own posts (${MELEK_SCOT.authorBps / 100}/${100 - MELEK_SCOT.authorBps / 100}).

Watching ${MELEK_SCOT.symbol} work is watching how a MELEK-Engine SCOT token works — mint, stake, curate, earn.`;
}

/** One-line status for a registry / HUD. */
export function status({ minted = false } = {}) {
  return { name: MELEK_SCOT.name, symbol: MELEK_SCOT.symbol, kind: 'SCOT', chain: 'MELEK-Engine',
    status: minted ? 'live' : 'design', universal: true, distributesAlongside: 'MELEK', provisionalName: false };
}
