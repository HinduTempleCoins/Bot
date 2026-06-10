// discord-chain-bridge.mjs — a Discord ↔ MELEK-testnet bridge, modeled on HIVE's PIZZA bot.
//
// THE PIZZA PATTERN
//   On HIVE, the PIZZA bot lets a Discord command ("!tip @user 5 PIZZA") trigger an on-chain
//   token action, and surfaces on-chain events back into Discord ("@a tipped @b 5 PIZZA"). This
//   module is that pattern for the MELEK testnet: it maps Discord prefix commands to standard
//   Graphene ops, and renders relevant on-chain events as Discord messages. It is BIDIRECTIONAL.
//
// WHAT THIS MODULE IS / ISN'T
//   • PURE + TESTABLE. parseCommand/toChainOp/fromChainEvent build strings and op-arrays only.
//   • It NEVER broadcasts and NEVER holds a key. toChainOp() returns the Graphene op(s); the HOST
//     broadcasts them via the JIT-vault key / MELEK-Signer (BRIEF.md §7, "Zero WIF on host").
//   • The live Discord client and the chain broadcaster are INJECTED at the edge (makeBridge),
//     so the offline tests need neither a Discord socket nor an RPC.
//
// REUSE
//   • commands/menu.mjs — the deterministic !balance / !witness / !price handlers (no LLM).
//   • integrations/hathor-discord.mjs — Hathor's disposition-greeting for the !welcome reply text.
//   • Op shapes mirror src/chain/graphene.js (transfer / comment / custom_json) and
//     witness/welcomer.mjs (the proven delegate+grant+ping welcome path).
//
// GUARDS (anti-drain, like PIZZA's daily limit)
//   • Per-user tip rate-limit (min seconds between tips) AND per-tip max-amount cap AND a per-user
//     daily total cap. A flood or an over-cap tip is REFUSED before any op is built.
//   • Testnet-only symbol: TESTS. The bridge refuses to denominate a tip in anything else here.
//
//   import { makeBridge, parseCommand, toChainOp, fromChainEvent, BRIDGE_DEFAULTS } from './discord-chain-bridge.mjs'

import { handle as menuHandle, normalizeAccount } from '../commands/menu.mjs';

// hathor-discord.mjs gives the !welcome reply its disposition-greeting. Defensive import: if the
// persona surface is unavailable, the welcome still works with a plain (still warm) fallback line.
let _persona = null;
try {
  _persona = await import('./hathor-discord.mjs');
} catch {
  _persona = null;
}

// ── esc() — house style: escape all interpolation that could reach a markup/markdown surface ──────
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── config ───────────────────────────────────────────────────────────────────────────────────────
// Testnet-only by construction (CLAUDE.md: testnet symbols TESTS/TBD; mainnet MELEK/MBD). The bridge
// denominates tips in TESTS and refuses any other symbol — a live demo runs on the testnet only.
export const SYMBOL = 'TESTS';

export const BRIDGE_DEFAULTS = {
  symbol: SYMBOL,
  maxTip: 25,            // per-tip cap (whole tokens) — anti-drain
  dailyCapPerUser: 100,  // per-tipper daily total (whole tokens) — anti-drain
  rateLimitSec: 30,      // min seconds between tips from the SAME tipper — anti-flood
  hathor: 'hathor',      // the witness account; welcome ops come FROM it
  welcomeDelegation: '200.000000 VESTS', // proven RC-bootstrap delegation (welcomer.mjs)
  welcomeGrant: 10,      // TESTS granted on !welcome (whole tokens)
  welcomePostAuthor: 'hathor',
  welcomePostPermlink: '', // host sets the live welcome-post permlink for the ping comment
};

const DAY_MS = 24 * 3600 * 1000;

// ── amount formatting ─────────────────────────────────────────────────────────────────────────────
// Graphene assets are fixed-precision strings: "10.000 TESTS". Our testnet token uses 3 decimals.
function formatAsset(amount, symbol = SYMBOL) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(3)} ${symbol}`;
}

function parseAmount(token) {
  if (token == null) return NaN;
  // strip a trailing symbol if the user typed "!tip @x 5 TESTS"
  const s = String(token).replace(/[, ]/g, '').replace(/TESTS?$/i, '');
  return Number(s);
}

// ── parseCommand — Discord text → { cmd, args, ... } ───────────────────────────────────────────────
// Accepts both prefix ("!tip @bob 5") and slash ("/tip @bob 5") forms; leading whitespace tolerated.
// Returns a normalized shape per command. null when the text is not a bridge command.
//
//   !tip @user <amt>   -> { cmd:'tip', to, amount }
//   !balance [@user]   -> { cmd:'balance', account }
//   !witness [@user]   -> { cmd:'witness', account }
//   !price [symbol]    -> { cmd:'price', symbol }
//   !welcome @user     -> { cmd:'welcome', to }
const CMD_RE = /^\s*[!/]([a-z][a-z0-9-]*)\b\s*(.*)$/i;

export function parseCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(CMD_RE);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  // first line only — keep multi-line tails out of args
  const rest = m[2].split('\n')[0].trim();
  const args = rest ? rest.split(/\s+/) : [];

  switch (cmd) {
    case 'tip': {
      const to = normalizeAccount(args[0] || '');
      const amount = parseAmount(args[1]);
      return { cmd, to, amount, raw: args };
    }
    case 'welcome': {
      const to = normalizeAccount(args[0] || '');
      return { cmd, to, raw: args };
    }
    case 'balance':
    case 'witness': {
      const account = normalizeAccount(args[0] || '');
      return { cmd, account, raw: args };
    }
    case 'price': {
      const symbol = (args[0] || 'hive').toLowerCase().replace(/^[#$@]/, '');
      return { cmd, symbol, raw: args };
    }
    default:
      return { cmd, raw: args };
  }
}

// ── rate-limit / cap state ─────────────────────────────────────────────────────────────────────────
// A tiny in-memory ledger keyed by tipper. Injectable `now` for deterministic tests; the host can
// supply a persistent store later. State lives on the object the host owns.
export function makeTipLedger() {
  const byUser = new Map(); // user -> { last:ms, daySpent:number, dayStart:ms }
  return {
    /** check (without recording) whether `user` may tip `amount` now; returns { ok, reason } */
    check(user, amount, rules, now = Date.now()) {
      const r = { ...BRIDGE_DEFAULTS, ...rules };
      const rec = byUser.get(user) || { last: 0, daySpent: 0, dayStart: 0 };
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const spentToday = rec.dayStart === dayStart ? rec.daySpent : 0;
      if (now - rec.last < r.rateLimitSec * 1000) {
        const wait = Math.ceil((r.rateLimitSec * 1000 - (now - rec.last)) / 1000);
        return { ok: false, reason: `rate-limited — wait ${wait}s between tips` };
      }
      if (amount > r.maxTip) {
        return { ok: false, reason: `tip ${amount} exceeds the per-tip cap of ${r.maxTip} ${r.symbol}` };
      }
      if (spentToday + amount > r.dailyCapPerUser) {
        return { ok: false, reason: `daily cap reached — ${spentToday}/${r.dailyCapPerUser} ${r.symbol} already tipped today` };
      }
      return { ok: true, reason: '' };
    },
    /** record a successful tip (advances rate-limit clock + daily total) */
    record(user, amount, now = Date.now()) {
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const rec = byUser.get(user) || { last: 0, daySpent: 0, dayStart };
      const spentToday = rec.dayStart === dayStart ? rec.daySpent : 0;
      byUser.set(user, { last: now, daySpent: spentToday + amount, dayStart });
    },
    _peek(user) { return byUser.get(user) || null; },
  };
}

// ── toChainOp — command → the Graphene op(s) to broadcast (NO broadcast here) ──────────────────────
// Pure. Returns { ok, ops, reply, error } where:
//   ops    : Graphene op array [["transfer", {...}], ...] for the HOST to sign+broadcast, or [] for
//            read-only commands (balance/witness/price) that the host answers via the menu instead.
//   reply  : the Discord text to post (optional preview/confirmation line).
//   needs  : optional list of accounts whose key the host must use (e.g. the tipper for a tip).
//
// ctx:
//   from     : the on-chain account of the Discord user issuing the command (the tipper / caller).
//              REQUIRED for !tip (the tip comes FROM the tipper, not from Hathor).
//   ledger   : a makeTipLedger() instance for rate/cap enforcement (optional; if absent, only the
//              per-tip cap applies as a hard floor).
//   rules    : overrides of BRIDGE_DEFAULTS.
//   now      : injectable clock.
export function toChainOp(command, ctx = {}) {
  if (!command || typeof command !== 'object') {
    return { ok: false, ops: [], error: 'no command' };
  }
  const r = { ...BRIDGE_DEFAULTS, ...(ctx.rules || {}) };
  const now = typeof ctx.now === 'number' ? ctx.now : Date.now();

  switch (command.cmd) {
    case 'tip': {
      const from = normalizeAccount(ctx.from || '');
      if (!from) return { ok: false, ops: [], error: 'tip requires a linked from-account (who is tipping)' };
      if (!command.to) return { ok: false, ops: [], error: 'usage: !tip @user <amount>' };
      if (command.to === from) return { ok: false, ops: [], error: 'you cannot tip yourself' };
      const amount = Number(command.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, ops: [], error: 'usage: !tip @user <amount> — amount must be a positive number' };
      }
      // anti-drain gates
      if (ctx.ledger && typeof ctx.ledger.check === 'function') {
        const g = ctx.ledger.check(from, amount, r, now);
        if (!g.ok) return { ok: false, ops: [], error: g.reason, capped: true };
      } else if (amount > r.maxTip) {
        // even without a ledger, the per-tip cap still applies (hard floor)
        return { ok: false, ops: [], error: `tip ${amount} exceeds the per-tip cap of ${r.maxTip} ${r.symbol}`, capped: true };
      }
      const asset = formatAsset(amount, r.symbol);
      if (!asset) return { ok: false, ops: [], error: 'bad amount' };
      const op = ['transfer', {
        from,
        to: command.to,
        amount: asset,
        memo: esc(`Discord tip from @${from} via Hathor bridge`),
      }];
      if (ctx.ledger && typeof ctx.ledger.record === 'function') ctx.ledger.record(from, amount, now);
      return {
        ok: true,
        ops: [op],
        needs: [from],            // host signs with the tipper's active key
        reply: `@${esc(from)} → @${esc(command.to)}: ${esc(asset)} sent on the MELEK testnet.`,
      };
    }

    case 'welcome': {
      if (!command.to) return { ok: false, ops: [], error: 'usage: !welcome @user' };
      const hathor = normalizeAccount(r.hathor) || 'hathor';
      const ops = [];
      // 1. delegate POWER so the newcomer has Resource Credits (proven welcomer path)
      ops.push(['delegate_vesting_shares', {
        delegator: hathor,
        delegatee: command.to,
        vesting_shares: r.welcomeDelegation,
      }]);
      // 2. grant a small amount of TESTS
      const grant = formatAsset(r.welcomeGrant, r.symbol);
      if (grant) {
        ops.push(['transfer', { from: hathor, to: command.to, amount: grant, memo: esc('Welcome to MELEK') }]);
      }
      // 3. ping the newcomer in a comment reply on Hathor's welcome post (the wallet-notification path)
      if (r.welcomePostPermlink) {
        const greet = welcomeText(command.to);
        ops.push(['comment', {
          parent_author: r.welcomePostAuthor,
          parent_permlink: r.welcomePostPermlink,
          author: hathor,
          permlink: `welcome-${command.to}-${now}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 255),
          title: '',
          body: greet,
          json_metadata: JSON.stringify({ app: 'hathor/bridge', tags: ['welcome'] }),
        }]);
      }
      return {
        ok: true,
        ops,
        needs: [hathor],          // host signs with Hathor's active+posting keys
        reply: `Hathor welcomes @${esc(command.to)} — POWER delegated, ${esc(grant || '0')} granted${r.welcomePostPermlink ? ', and a ping on the welcome post' : ''}.`,
      };
    }

    // read-only commands map to NO chain op — the host answers them via the menu.
    case 'balance':
    case 'witness':
    case 'price':
      return { ok: true, ops: [], readonly: true, reply: '' };

    default:
      return { ok: false, ops: [], error: `unknown command: !${esc(command.cmd)} — try !help` };
  }
}

// The welcome reply text: Hathor's disposition-greeting where available, else a warm plain fallback.
function welcomeText(account) {
  const name = String(account || 'seeker');
  try {
    if (typeof _persona?.dispositionGreeting === 'function') {
      return _persona.dispositionGreeting({ user: name, context: 'signup', seed: name });
    }
  } catch { /* fall through to plain */ }
  return `Welcome to MELEK, @${name}. You stand at the doorway of the chain — step through, and I will show the way.`;
}

// ── runCommand — the host's one-call entry for a Discord message (read OR write) ───────────────────
// Wires the read-only commands to commands/menu.mjs (deterministic, no LLM) and the write commands to
// toChainOp() + the injected broadcaster. The broadcaster is the host's JIT-key / MELEK-Signer path;
// when it's absent, write commands DRY-RUN (build + return the op, broadcast nothing).
//
//   deps: { getAccount, getWitness, getPrice }  — same shape commands/menu.mjs takes (for read cmds)
//   broadcast: async ({ ops, needs }) => result — INJECTED signer; absent => dry-run
export async function runCommand(text, { from, deps = {}, broadcast, ledger, rules, now } = {}) {
  const command = parseCommand(text);
  if (!command) return { ok: false, kind: 'noop', reply: '' };

  // read-only: answer with the deterministic menu (reuse, no LLM)
  if (['balance', 'witness', 'price'].includes(command.cmd)) {
    let reply = '';
    try {
      reply = await menuHandle(menuTextFor(command), deps);
    } catch {
      reply = 'Lookup is unavailable right now.';
    }
    return { ok: true, kind: 'read', cmd: command.cmd, reply };
  }

  // write: build the op(s), then broadcast (or dry-run)
  const plan = toChainOp(command, { from, ledger, rules, now });
  if (!plan.ok) return { ok: false, kind: 'error', cmd: command.cmd, reply: plan.error, error: plan.error };

  if (typeof broadcast !== 'function') {
    return { ok: true, kind: 'dryrun', cmd: command.cmd, ops: plan.ops, reply: plan.reply, dryRun: true };
  }
  let result;
  try {
    result = await broadcast({ ops: plan.ops, needs: plan.needs });
  } catch (e) {
    return { ok: false, kind: 'broadcast-error', cmd: command.cmd, reply: 'The chain rejected that — try again shortly.', error: e?.message || String(e) };
  }
  return { ok: true, kind: 'write', cmd: command.cmd, ops: plan.ops, result, reply: plan.reply };
}

// Rebuild a `!cmd args` string for commands/menu.mjs from a parsed bridge command.
function menuTextFor(command) {
  if (command.cmd === 'price') return `!price ${command.symbol || 'hive'}`;
  if (command.cmd === 'balance') return `!balance @${command.account || ''}`;
  if (command.cmd === 'witness') return `!witness @${command.account || ''}`;
  return `!${command.cmd}`;
}

// ── fromChainEvent — an on-chain event → a Discord message (the other direction) ──────────────────
// Renders relevant ops/virtual-ops pulled from chain history into a Discord line, so on-chain
// activity surfaces back in the channel (PIZZA's "@a tipped @b" feed). Soft-fail to null when the
// event isn't one we surface. Accepts a raw op ['transfer', {...}] OR a history row { op:[...] }.
export function fromChainEvent(op) {
  try {
    const inner = Array.isArray(op?.op) ? op.op : op;
    if (!Array.isArray(inner) || inner.length < 2) return null;
    const [type, body] = inner;

    if (type === 'transfer' && body) {
      const memo = String(body.memo || '');
      const amount = String(body.amount || '');
      const from = String(body.from || '');
      const to = String(body.to || '');
      // only surface testnet-token transfers tied to our flows
      if (!/\bTESTS\b/.test(amount)) return null;
      if (/Welcome to MELEK/i.test(memo)) {
        return `🎁 Hathor granted ${esc(amount)} to @${esc(to)} — welcome to MELEK!`;
      }
      if (/Discord tip|via Hathor bridge|\btip\b/i.test(memo)) {
        const tail = stripMemoNoise(memo);
        return `💸 @${esc(from)} tipped @${esc(to)} ${esc(amount)}` + (tail ? ` — ${esc(tail)}` : '');
      }
      // a plain TESTS transfer is still worth surfacing in a testnet channel
      return `↗ @${esc(from)} sent @${esc(to)} ${esc(amount)}`;
    }

    if (type === 'comment' && body) {
      // a welcome ping: a Hathor reply tagged welcome on the welcome post
      let meta = {};
      try { meta = JSON.parse(body.json_metadata || '{}'); } catch { meta = {}; }
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      if (body.parent_author && tags.includes('welcome')) {
        const who = String(body.permlink || '').replace(/^welcome-/, '').replace(/-\d+$/, '');
        return `👋 Hathor welcomed @${esc(who || body.author)} on the chain.`;
      }
      return null;
    }

    if (type === 'delegate_vesting_shares' && body) {
      if (String(body.delegator) === BRIDGE_DEFAULTS.hathor && Number.parseFloat(body.vesting_shares) > 0) {
        return `⚡ Hathor delegated POWER to @${esc(body.delegatee)} (Resource Credits to get started).`;
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

function stripMemoNoise(memo) {
  return String(memo).replace(/\s*via Hathor bridge\s*/i, ' ').replace(/\s+/g, ' ').trim();
}

// ── makeBridge — wire a live Discord client + a chain broadcaster (host edge) ─────────────────────
// Both are INJECTED. The bridge:
//   • listens for messages → runCommand → posts the reply back to Discord
//   • (optionally) is fed chain events by the host's poller → fromChainEvent → posts to a channel
// This function does no I/O itself beyond calling the injected client; it holds NO key, NO token.
export function makeBridge({ discord, broadcast, deps = {}, channelId, rules, resolveAccount } = {}) {
  const ledger = makeTipLedger();

  async function onMessage(msg) {
    // msg: { content, authorId, reply(text) } — a thin shape the host adapts from discord.js
    const text = msg?.content || '';
    if (!parseCommand(text)) return null; // not a bridge command; ignore
    // map the Discord author to their on-chain account (host supplies the resolver)
    let from = '';
    try { from = (typeof resolveAccount === 'function') ? await resolveAccount(msg.authorId) : ''; }
    catch { from = ''; }
    const res = await runCommand(text, { from, deps, broadcast, ledger, rules });
    const out = res.reply || (res.error ? `⚠ ${res.error}` : '');
    if (out && typeof msg.reply === 'function') {
      try { await msg.reply(out); } catch { /* soft-fail: never throw into the Discord client */ }
    }
    return res;
  }

  async function onChainEvent(op) {
    const line = fromChainEvent(op);
    if (!line) return null;
    if (discord && typeof discord.send === 'function') {
      try { await discord.send(channelId, line); } catch { /* soft-fail */ }
    }
    return line;
  }

  // attach to the injected client if it exposes the hook
  if (discord && typeof discord.onMessage === 'function') {
    try { discord.onMessage(onMessage); } catch { /* host may attach manually */ }
  }

  return { onMessage, onChainEvent, ledger };
}

// ── CLI (guarded) — offline demo: parse + map a few commands, render an event ──────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-chain-bridge.mjs')) {
  const demos = ['!tip @alice 5', '!tip @bob 999', '!balance @hathor', '!price btc', '!welcome @newbie', '!frobnicate'];
  console.log('Discord → MELEK-testnet bridge (PIZZA pattern) — offline demo, NO broadcast, NO keys\n');
  for (const d of demos) {
    const cmd = parseCommand(d);
    const plan = cmd ? toChainOp(cmd, { from: 'tipper', rules: { welcomePostPermlink: 'welcome-to-melek' } }) : null;
    console.log(`  ${d.padEnd(18)} -> ${plan ? (plan.ok ? `ops=${plan.ops.length} ${plan.reply || '(read-only)'}` : `✗ ${plan.error}`) : 'not a command'}`);
  }
  console.log('\nOn-chain events surfaced back to Discord:');
  console.log('  ' + fromChainEvent(['transfer', { from: 'alice', to: 'bob', amount: '5.000 TESTS', memo: 'Discord tip from @alice via Hathor bridge' }]));
  console.log('  ' + fromChainEvent(['transfer', { from: 'hathor', to: 'newbie', amount: '10.000 TESTS', memo: 'Welcome to MELEK' }]));
  console.log('  ' + fromChainEvent(['delegate_vesting_shares', { delegator: 'hathor', delegatee: 'newbie', vesting_shares: '200.000000 VESTS' }]));
}
