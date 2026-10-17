// brain.mjs — ONE command brain for Hathor's helper bot, shared by every surface (Discord, Telegram, the
// on-chain troll-box) so a command behaves identically everywhere. Platform adapters only translate their
// message into { platform, userId, userName, text } and carry out the returned actions (reply, delete).
//
// Order of operations (load-bearing):
//   1. SECRET GUARD — before parsing, routing, AI or logging. A hit returns { secret, deleteMessage } and
//      the rotation warning; the message is never handled further.
//   2. Helper commands (deterministic, no LLM): tokenomics, !faucet, !link/!verify, !tip/!tips/!tipjar,
//      !guide/!next/!step/!back, !help.
//   3. Anything else → { handled:false } so the platform's existing handlers (legacy commands, free chat
//      via ai-route.mjs) carry on unchanged.
//
//   import { handle } from './helperbot/brain.mjs'
//   const out = await handle({ platform:'discord', userId, userName, text })

import { scanSecrets, rotationWarning } from './secret-guard.mjs';
import { tokenomicsCommand, TOKENOMICS_COMMANDS } from './tokenomics.mjs';
import { faucetCommand } from './faucet.mjs';
import { startLink, verifyLinks, parseIdentity, getLink, userKey } from './links.mjs';
import { tip, myTips, tipJar, tipConfig } from './tip.mjs';
import { guideCommand } from './guide.mjs';
import { steemdCommand, STEEMD_COMMANDS } from './steemd.mjs';
import { defaultStore, snowflakeTime } from './store.mjs';
import { LINKS } from './addresses.mjs';

export const HELPER_COMMANDS = new Set([
  ...TOKENOMICS_COMMANDS, ...STEEMD_COMMANDS, 'steemd', 'sb', 'faucet', 'link', 'verify', 'unlink', 'tip', 'tips', 'tipjar',
  'guide', 'next', 'step', 'back', 'help', 'menu', 'helper',
]);

/** Is the helper brain switched on for this process? (deploy flag; default OFF until operator review) */
export const enabled = (env = process.env) => env.HELPERBOT_ENABLED === '1';

const CMD_RX = /^\s*[!/]([a-z][a-z0-9-]*)(?:@\w+)?\b/i; // Telegram appends @BotName to /commands

export function parse(text) {
  const m = String(text || '').match(CMD_RX);
  if (!m) return null;
  const line = String(text).split('\n')[0].replace(CMD_RX, '').trim();
  return { cmd: m[1].toLowerCase(), args: line ? line.split(/\s+/) : [] };
}

export function helpText(cfg = tipConfig()) {
  return [
    '🌿 **Hathor — helper bot** (I never need your password, keys or seed — only public names/addresses)',
    '**Tokenomics (live):** `!tokenomics` · `!prana` · `!kula` · `!melek` · `!vkbt` · `!cure` · `!wvkbt` · `!wcure` · `!wmelek` · `!apis`',
    '**Faucet:** `!faucet` · `!faucet prana 0x…` (testnet) · `!faucet melek [testnet]`',
    `**Tips (PIZZA-style, ${cfg.symbol}):** \`!link ${cfg.identity === 'prana' ? '0x…' : '@account'}\` → \`!verify\` · \`!tip @user [n]\` · \`!tips\` · \`!tipjar\``,
    '**Guides (step-by-step, checked on-chain):** `!guide` · `!guide signup` · `!guide swap` · `!guide bridge` · `!guide stake` · `!guide pool` · `!next` · `!step` · `!guide stop`',
    '**MELEK steemd (live chain, 24/7):** `!account @a` · `!balance @a` · `!rc @a` · `!delegations @a` · `!followers @a` · `!following @a` · `!blog @a`',
    '  `!post @a/permlink` · `!payout …` · `!votes …` · `!replies …` · `!trending [tag]` · `!hot` · `!new`',
    '  `!witness @w` · `!witnesses` · `!schedule` · `!missed @w` · `!hathor` · `!feed` · `!chain` · `!hardfork` · `!rewardfund` · `!block [n]` · `!tx <id> [block]` · `!engine [@a]` · `!nodes`',
    '**Ask:** `!ask <question>` (Resource Center)',
    `Community: ${LINKS.discord} · map of everything: ${LINKS.map}`,
  ].join('\n');
}

const STATEFUL = new Set(['link', 'verify', 'unlink', 'tip', 'tips', 'guide', 'next', 'step', 'back']);
const DISCORD_MENTION = /^<@!?(\d+)>$/;

/**
 * handle(msg, ctx) → Promise<{ handled, reply?, secret?, deleteMessage?, route? }>. Never throws.
 * msg: { platform, userId, userName, text, accountCreatedAt?, karma?, resolveMention?(token)→userId|null }
 */
export async function handle(msg = {}, ctx = {}) {
  const text = typeof msg.text === 'string' ? msg.text : '';
  // 1) secret guard — always, even when the helper commands are disabled
  let scan = { hit: false, kinds: [] };
  try { scan = scanSecrets(text); } catch { /* scanner is pure; belt and braces */ }
  if (scan.hit) {
    const canDelete = msg.platform === 'discord' || msg.platform === 'telegram';
    return { handled: true, route: 'secret', secret: { kinds: scan.kinds }, deleteMessage: canDelete, reply: rotationWarning(scan.kinds, { deleted: canDelete, platform: msg.platform }) };
  }
  if (ctx.commandsEnabled === false) return { handled: false };

  let p = parse(text);
  if (!p || !HELPER_COMMANDS.has(p.cmd)) return { handled: false };
  // `!steemd <chain cmd> …` / `!sb <chain cmd> …` → the mainnet chain set; other steemd verbs (markets,
  // clarity, …) stay with the legacy integrations/soapbox/steemd.mjs handler.
  if (p.cmd === 'steemd' || p.cmd === 'sb') {
    const sub = String(p.args[0] || '').toLowerCase();
    if (!STEEMD_COMMANDS.includes(sub)) return { handled: false };
    p = { cmd: sub, args: p.args.slice(1) };
  }
  try {
    const reply = await route(p, msg, ctx);
    return reply == null ? { handled: false } : { handled: true, route: p.cmd, reply: String(reply).slice(0, 1900) };
  } catch {
    return { handled: true, route: p.cmd, reply: 'Something went wrong on my side — nothing was sent or changed. Try again shortly.' };
  }
}

async function route({ cmd, args }, msg, ctx) {
  const store = ctx.store || defaultStore();
  const now = ctx.now || Date.now();
  const platform = msg.platform || 'unknown';
  const userId = String(msg.userId || 'anon');
  const who = { platform, userId, accountCreatedAt: msg.accountCreatedAt ?? (platform === 'discord' ? snowflakeTime(userId) : null), karma: msg.karma };

  if (TOKENOMICS_COMMANDS.includes(cmd)) return tokenomicsCommand(cmd, args);
  if (STEEMD_COMMANDS.includes(cmd)) return steemdCommand(cmd, args);
  // Anonymous surfaces (the public web chat tags everyone 'web') can't hold per-user state safely.
  if (STATEFUL.has(cmd) && (platform === 'web' || userId === 'anon')) {
    return `\`!${cmd}\` needs a per-user session — use it in our Discord (${LINKS.discord}) or Telegram. Tokenomics and \`!faucet\` work here.`;
  }
  switch (cmd) {
    case 'help': case 'menu': case 'helper': return helpText(ctx.tipCfg);
    case 'faucet': return faucetCommand(args, who, { store, now, cfg: ctx.faucetCfg });
    case 'link': {
      const id = parseIdentity(args[0]);
      if (!id) return 'Usage: `!link 0xYourPranaAddress` or `!link @yourmelekaccount` — PUBLIC only, never a key.';
      return startLink({ store, platform, userId, identity: id, now, melekNet: (ctx.tipCfg || tipConfig()).net === 'testnet' ? 'testnet' : 'mainnet' }).reply;
    }
    case 'verify': return (await verifyLinks({ store, platform, userId, now })).reply;
    case 'unlink': {
      const cur = getLink(store, platform, userId);
      if (cur.prana && cur.prana.verified) store.del(`owner:prana:${cur.prana.address}`);
      if (cur.melek && cur.melek.verified) store.del(`owner:melek:${cur.melek.account}`);
      store.del(userKey(platform, userId));
      return 'Unlinked.';
    }
    case 'tip': {
      const t = args[0] || '';
      const m = t.match(DISCORD_MENTION);
      let target = null;
      if (m) target = { userId: m[1] };
      else if (typeof msg.resolveMention === 'function' && msg.resolveMention(t)) target = { userId: msg.resolveMention(t) };
      else if (t) target = { raw: t };
      const r = await tip({ platform, userId, userName: msg.userName || 'you', target, count: args[1] || 1 }, { store, now, cfg: ctx.tipCfg, signer: ctx.tipSigner || null });
      return r.reply;
    }
    case 'tips': return myTips({ platform, userId }, { store, now, cfg: ctx.tipCfg });
    case 'tipjar': return tipJar({ store, now, cfg: ctx.tipCfg });
    case 'guide': case 'next': case 'step': case 'back': return guideCommand(cmd, args, who, { store, now });
    default: return null;
  }
}
