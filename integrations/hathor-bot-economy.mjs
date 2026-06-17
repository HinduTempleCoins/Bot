// hathor-bot-economy.mjs — Hathor's PM token economy for Discord + Telegram (operator 2026-06-17:
// "expand the NutBox-type concept to Discord and Telegram, where people connect a wallet to Hathor in PMs
// and then there are ways to use the Token and get the Token").
//
// Surface-agnostic PM command router. A user DMs Hathor; she links their wallet, drips the utility token
// from the FAUCET (claim-based, cooldown'd, Crypt-ology-gated — never infinite), reports balances, and
// stages stake/spend (games/access) intents. ONE identity across chains via unified-identity (a MELEK @
// or a PRANA 0x both work; tokens auto-wrap). Keyless: Hathor SIGNS ONLY her own faucet drip — every user
// action is returned as an unsigned intent for the host/user to execute. No keys here, soft-fail, injectable.
//
// handlePm({ platformUser, text }, deps) -> { reply, kind, action? }  — Discord/Telegram adapters call this.

import { classifyId, resolveIdentity, routeTransfer, normMelek, isPranaAddress, isMelekAccount } from './unified-identity.mjs';
import { buildVoteOrder } from '../kulaswap/alti-vote-market.mjs';

// ── link registry (platformUser -> {melek, prana}) — the PM wallet-connect store ──────────────────────────
// platformUser is "discord:<id>" / "telegram:<id>". Injected store (load/save) so it's testable + forkable.
function emptyStore() { return { byUser: {}, links: {} }; }

/** Parse a PM into a command + args. Lenient: leading !/slash optional. */
export function parseCommand(text) {
  const t = String(text || '').trim().replace(/^[!/]/, '');
  const [cmd, ...rest] = t.split(/\s+/);
  return { cmd: (cmd || '').toLowerCase(), args: rest, raw: t };
}

const HELP = [
  '**Hathor — your wallet in a DM.**',
  '• `link <0x… or @melekname>` — connect your wallet (one identity, both chains).',
  '• `claim` — claim your faucet drip of the utility token (once/day, earned by good standing).',
  '• `balance` — your balance + your linked wallet.',
  '• `me` — how we stand (your Crypt-ology disposition).',
  '• `stake <amount>` / `spend <amount> <on>` — put the token to work (games, access).',
  '• `vote <@author/permlink> <alti>` — spend ALTI for a proportional upvote from @soapbox.',
].join('\n');

/**
 * handlePm — the PM brain. deps:
 *   store {byUser, links}   — the link registry (mutated + handed back via deps.save)
 *   save(store)             — persist the registry (optional)
 *   faucet({account,...})   — faucetClaim from cryptology/hathor-disposition (returns {ok,amount,reason,...})
 *   balanceOf(identity)     — async balance reader (optional)
 *   now()                   — clock
 *   keccak                  — for shadow-address resolution (host injects ethers.id)
 *   lastClaimAt(account)    — when this account last claimed (for the faucet cooldown)
 *   reservoir               — remaining faucet reservoir (finite)
 */
export async function handlePm({ platformUser, text } = {}, deps = {}) {
  const store = deps.store || emptyStore();
  const who = String(platformUser || '').trim();
  if (!who) return { reply: 'I could not identify you on this platform.', kind: 'error' };
  const { cmd, args } = parseCommand(text);
  const link = store.byUser[who] || null; // { melek?, prana? }

  if (!cmd || cmd === 'help' || cmd === 'start') return { reply: HELP, kind: 'help' };

  // link <id> — connect a wallet (a 0x or a @). Builds the unified identity + Crypt-ology key.
  if (cmd === 'link') {
    const id = (args[0] || '').trim();
    const kind = classifyId(id);
    if (kind === 'invalid') return { reply: 'Give me a PRANA address (`0x…`) or a MELEK name (`@you`).', kind: 'link-bad' };
    const resolved = resolveIdentity(id, { registry: store, keccak: deps.keccak });
    const entry = { melek: resolved.melek || (link && link.melek) || null, prana: resolved.prana || (link && link.prana) || null };
    store.byUser[who] = entry;
    if (entry.melek && entry.prana) store.links[entry.melek] = entry.prana; // feed the @↔0x registry
    if (deps.save) { try { deps.save(store); } catch { /* soft */ } }
    return {
      reply: `Linked. ${entry.melek ? `MELEK **@${entry.melek}**` : ''}${entry.melek && entry.prana ? ' · ' : ''}${entry.prana ? `PRANA \`${entry.prana}\`${resolved.pranaIsShadow ? ' (auto-derived — link a real 0x to override)' : ''}` : ''}. Try \`claim\`.`,
      kind: 'linked', action: { type: 'link', user: who, ...entry },
    };
  }

  // Everything below needs a linked identity.
  if (!link || !(link.melek || link.prana)) {
    return { reply: 'First connect a wallet: `link <0x… or @melekname>`.', kind: 'needs-link' };
  }
  const account = link.melek || (link.prana ? link.prana.toLowerCase() : ''); // Crypt-ology key (prefer @)

  if (cmd === 'me') {
    const disp = typeof deps.dispositionFor === 'function' ? deps.dispositionFor(account) : null;
    return {
      reply: disp ? `We stand: **${disp.stance}** (closeness ${disp.closeness}, standing ${disp.standing}). The faucet rewards giving back.`
                  : `You're linked${link.melek ? ` as @${link.melek}` : ''}. We're still getting acquainted.`,
      kind: 'me',
    };
  }

  if (cmd === 'claim') {
    if (typeof deps.faucet !== 'function') return { reply: 'The faucet is warming up — try again shortly.', kind: 'faucet-unavailable' };
    const res = deps.faucet({
      account, now: deps.now ? deps.now() : Date.now(),
      lastClaimAt: deps.lastClaimAt ? deps.lastClaimAt(account) : 0,
      reservoir: deps.reservoir == null ? Infinity : deps.reservoir,
    });
    if (!res.ok) {
      const msg = {
        cooldown: `You already claimed recently — the tap refills once a day. Next: <t:${Math.floor((res.nextClaimAt || 0) / 1000)}:R>.`,
        'reservoir-empty': 'The faucet is dry right now — check back when it refills.',
        'standing-too-low': "We're not there yet — spend some time in the community first.",
        'taker-no-reciprocity': 'The faucet rewards giving back, not just taking. Help someone here first. 🙂',
      }[res.reason] || 'No drip available right now.';
      return { reply: msg, kind: 'claim-denied', reason: res.reason };
    }
    // Hathor SIGNS this drip herself (the only thing she signs); the host executes it to the linked wallet.
    const route = routeTransfer({ toInput: link.prana || ('@' + link.melek), tokenChain: deps.tokenChain || 'melek', registry: store, keccak: deps.keccak });
    return {
      reply: `Sent you **${res.amount}** ${deps.tokenSymbol || 'APIS'} 🚰 — ${route.wrap ? `wrapped onto ${route.chain.toUpperCase()}` : `on ${route.chain.toUpperCase()}`}. Use it for games + access; come back tomorrow.`,
      kind: 'claim-ok',
      action: { type: 'faucet-drip', to: route.to, chain: route.chain, wrap: route.wrap, amount: res.amount, account },
    };
  }

  if (cmd === 'balance' || cmd === 'wallet') {
    const idStr = link.melek ? '@' + link.melek : link.prana;
    const bal = typeof deps.balanceOf === 'function' ? await deps.balanceOf(link).catch(() => null) : null;
    return { reply: `Your wallet: ${idStr}${link.melek && link.prana ? ` · \`${link.prana}\`` : ''}.${bal != null ? ` Balance: **${bal}** ${deps.tokenSymbol || 'APIS'}.` : ''}`, kind: 'balance' };
  }

  if (cmd === 'vote') {
    // vote <@author/permlink> <alti> — spend ALTI for a @soapbox upvote (the ALTI vote market).
    const m = /^@?([a-z0-9.\-]+)\/(\S+)$/i.exec(args[0] || '');
    const altiSpent = +(args[1] || 0);
    if (!m || !(altiSpent > 0)) return { reply: 'Usage: `vote <@author/permlink> <alti>`.', kind: 'usage' };
    const order = buildVoteOrder({
      account, author: m[1], permlink: m[2], altiSpent,
      votingManaBps: deps.voterManaBps,                 // optional; defaults to full mana in the market
      market: deps.voteMarket, altiSpendTo: deps.altiSink || null,
    });
    if (!order.ok) {
      const why = order.reason === 'voter-out-of-mana' ? "@soapbox is out of voting power right now — try again later."
        : order.reason === 'below-minimum' ? 'That ALTI amount is below the minimum.' : 'I couldn’t build that vote.';
      return { reply: why, kind: 'vote-denied', action: order };
    }
    const q = order.quote;
    const refund = q.altiRefunded > 0 ? ` (${q.altiRefunded} ALTI refunded)` : '';
    return {
      reply: `Spend **${q.altiCharged} ALTI**${refund} → a **${q.weightPct}%** upvote on @${m[1]}/${m[2]} from @${order.vote.voter}. Confirm the ALTI transfer in your wallet.`,
      kind: 'vote-ok', action: order,
    };
  }

  if (cmd === 'stake' || cmd === 'spend') {
    const amount = +(args[0] || 0);
    if (!(amount > 0)) return { reply: `Usage: \`${cmd} <amount>${cmd === 'spend' ? ' <on>' : ''}\`.`, kind: 'usage' };
    // Returned as an unsigned intent — the user signs it in their wallet (Hathor never holds user keys).
    return {
      reply: `Prepared a ${cmd} of **${amount}** ${deps.tokenSymbol || 'APIS'}${cmd === 'spend' && args[1] ? ` on ${args[1]}` : ''}. Confirm it in your wallet to complete.`,
      kind: cmd, action: { type: cmd, account, amount, on: cmd === 'spend' ? (args[1] || '') : undefined, unsigned: true },
    };
  }

  return { reply: `I didn't catch that. ${HELP}`, kind: 'unknown' };
}

export { emptyStore };
