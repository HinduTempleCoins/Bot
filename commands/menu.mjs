/**
 * commands/menu.mjs — Hathor's deterministic command menu (Phase 2, queue #36).
 *
 * NO LLM. Pure, deterministic templates. The menu of valid `!commands` is
 * fixed at module-load time; everything routes through a small parser and a
 * handler table.
 *
 * Unlike commands/index.js (which couples handlers to a live GrapheneAdapter
 * via ctx.adapter), this module takes an injected `deps` object of async
 * data-source functions, so every handler is testable WITHOUT a network or
 * an RPC client. Callers wire the real data sources at the edge:
 *
 *   import { handle } from './commands/menu.mjs';
 *   const reply = await handle(body, {
 *     getAccount:   (name)   => adapter.getAccount(name),
 *     getWitness:   (name)   => adapter.getWitness(name),
 *     getPrice:     (symbol) => oracle.priceUsd(symbol),
 *   });
 *
 * Exports:
 *   parseCommand(text)  -> { cmd, args } | null
 *   handle(text, deps)  -> Promise<string>   (the reply to post back)
 *   COMMANDS            -> help registry (array of {name, args, help})
 *
 * Convention: invocations start with `!` (leading whitespace tolerated). The
 * first token after `!` is the command name; remaining whitespace-split tokens
 * are args.
 */

const COMMAND_REGEX = /^\s*!([a-z][a-z0-9-]*)\b/i;

/**
 * @typedef {object} Parsed
 * @property {string} cmd     lowercase command name, no leading `!`
 * @property {string[]} args  whitespace-split tokens after the command
 */

/**
 * Parse a `!command` invocation out of a comment body or transfer memo.
 * Returns null when the text is not a command.
 *
 * @param {string|undefined|null} text
 * @returns {Parsed|null}
 */
export function parseCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(COMMAND_REGEX);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  // First line only for args; multi-line bodies keep their tail out of args.
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const afterCmd = firstLine.replace(COMMAND_REGEX, '').trim();
  const args = afterCmd ? afterCmd.split(/\s+/) : [];
  return { cmd, args };
}

/**
 * Normalize an account-name argument: strip a leading `@`, lowercase, trim.
 * Returns null for empty input or names that aren't valid Graphene account
 * names (3-16 chars per segment, lowercase a-z/0-9/hyphen, letter-led,
 * dot-separated segments allowed).
 *
 * @param {string} token
 * @returns {string|null}
 */
export function normalizeAccount(token) {
  if (typeof token !== 'string') return null;
  let s = token.trim().toLowerCase();
  if (s.startsWith('@')) s = s.slice(1);
  if (!s) return null;
  if (!/^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]{2,15})*$/.test(s)) return null;
  return s;
}

// Common tickers people type -> canonical price symbol the oracle understands.
const PRICE_ALIAS = {
  hive: 'hive', btc: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum',
  ethereum: 'ethereum', ltc: 'litecoin', litecoin: 'litecoin', doge: 'dogecoin',
  dogecoin: 'dogecoin', steem: 'steem', blurt: 'blurt', hbd: 'hive_dollar',
  sol: 'solana', solana: 'solana', melek: 'melek',
};

// ---- handlers --------------------------------------------------------------
// Each handler: async (args: string[], deps) -> reply string.
// Handlers never throw for "expected" failures (not found, bad input, missing
// dep) — they return a helpful string. They surface unexpected data-source
// errors as a short, deterministic message rather than letting them propagate.

async function helpHandler(args) {
  const target = args[0]?.toLowerCase().replace(/^!/, '');
  if (target) {
    const entry = COMMANDS.find((c) => c.name === target);
    if (!entry) {
      return `Unknown command: !${target}. Try !help for the list.`;
    }
    return `!${entry.name}${entry.args ? ' ' + entry.args : ''}\n${entry.help}`;
  }
  const lines = COMMANDS
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `!${c.name}${c.args ? ' ' + c.args : ''} — ${c.help.split('\n')[0]}`);
  return `Available commands:\n\n${lines.join('\n')}\n\nUse !help <command> for details on one.`;
}

async function balanceHandler(args, deps) {
  const target = normalizeAccount(args[0] || '');
  if (!target) return 'Usage: !balance @account';
  if (typeof deps?.getAccount !== 'function') {
    return 'Balance lookup is unavailable right now.';
  }
  let acct;
  try {
    acct = await deps.getAccount(target);
  } catch {
    return `Could not look up @${target} right now. Try again shortly.`;
  }
  if (!acct) return `@${target} not found on this chain.`;
  const lines = [
    `@${target}`,
    `Liquid: ${acct.balance ?? '(unknown)'}`,
    `Vesting: ${acct.vesting_shares ?? '(unknown)'}`,
  ];
  if (acct.savings_balance) lines.push(`Savings: ${acct.savings_balance}`);
  return lines.join('\n');
}

async function witnessHandler(args, deps) {
  const target = normalizeAccount(args[0] || '');
  if (!target) return 'Usage: !witness @account';
  if (typeof deps?.getWitness !== 'function') {
    return 'Witness lookup is unavailable right now.';
  }
  let w;
  try {
    w = await deps.getWitness(target);
  } catch {
    return `Could not look up witness @${target} right now. Try again shortly.`;
  }
  if (!w) return `@${target} is not a witness.`;
  const lines = [
    `@${target} witness record`,
    `URL: ${w.url || '(none)'}`,
    `Block-signing key: ${w.signing_key ?? '(unknown)'}`,
    `Last confirmed: block ${w.last_confirmed_block_num ?? '(unknown)'}`,
    `Missed: ${w.total_missed ?? '(unknown)'}`,
  ];
  return lines.join('\n');
}

async function postCountHandler(args, deps) {
  const target = normalizeAccount(args[0] || '');
  if (!target) return 'Usage: !post-count @account';
  if (typeof deps?.getAccount !== 'function') {
    return 'Account lookup is unavailable right now.';
  }
  let acct;
  try {
    acct = await deps.getAccount(target);
  } catch {
    return `Could not look up @${target} right now. Try again shortly.`;
  }
  if (!acct) return `@${target} not found on this chain.`;
  const count = acct.post_count ?? 0;
  const rep = acct.reputation != null ? `. Reputation: ${acct.reputation}` : '';
  return `@${target} has ${count} posts/comments total${rep}.`;
}

async function priceHandler(args, deps) {
  const raw = (args[0] || 'hive').toLowerCase().replace(/^[#$@]/, '');
  if (typeof deps?.getPrice !== 'function') {
    return 'Price lookup is unavailable right now.';
  }
  const symbol = PRICE_ALIAS[raw] || raw;
  let p;
  try {
    p = await deps.getPrice(symbol);
  } catch {
    return `Could not fetch a price for "${raw}" right now. Try again shortly.`;
  }
  if (!p || p.usd == null) {
    return `No confident price found for "${raw}". Try: !price hive | btc | eth | sol`;
  }
  const usd = Number(p.usd);
  const shown = usd < 1 ? usd.toFixed(6) : usd.toFixed(2);
  const sources = p.sources != null
    ? ` (${p.sources} source${p.sources === 1 ? '' : 's'})`
    : '';
  const flag = p.confident === false ? ' (unconfirmed — few sources)' : '';
  return `${raw.toUpperCase()}: $${shown}${sources}${flag}`;
}

// ---- registry --------------------------------------------------------------

/**
 * The help registry: the fixed menu of deterministic commands. Each entry
 * carries its one-line help (for `!help`) plus the handler used by `handle()`.
 *
 * @type {Array<{name: string, args: string, help: string, handler: Function}>}
 */
export const COMMANDS = [
  {
    name: 'help',
    args: '[command]',
    help: 'Show available commands, or details for one command.',
    handler: helpHandler,
  },
  {
    name: 'balance',
    args: '@account',
    help: 'Show liquid + vesting balance for an account.',
    handler: balanceHandler,
  },
  {
    name: 'witness',
    args: '@account',
    help: 'Show the witness record for an account: URL, signing key, missed blocks.',
    handler: witnessHandler,
  },
  {
    name: 'post-count',
    args: '@account',
    help: 'Show post/comment count and reputation for an account.',
    handler: postCountHandler,
  },
  {
    name: 'price',
    args: '[symbol]',
    help: 'Show the USD price of an asset (default HIVE).',
    handler: priceHandler,
  },
];

const HANDLERS = new Map(COMMANDS.map((c) => [c.name, c.handler]));

/**
 * Parse `text`, route to the matching handler, and return the reply string.
 *
 * - Non-command text -> '' (caller decides whether to ignore).
 * - Unknown command  -> a helpful usage pointer to !help.
 *
 * @param {string} text          a comment body or transfer memo.
 * @param {object} [deps]        injected async data sources:
 *   getAccount(name) -> { balance, vesting_shares, savings_balance, post_count, reputation } | null
 *   getWitness(name) -> { url, signing_key, last_confirmed_block_num, total_missed } | null
 *   getPrice(symbol) -> { usd, sources?, confident? } | null
 * @returns {Promise<string>}
 */
export async function handle(text, deps = {}) {
  const parsed = parseCommand(text);
  if (!parsed) return '';
  const handler = HANDLERS.get(parsed.cmd);
  if (!handler) {
    return `Unknown command: !${parsed.cmd}. Try !help for the list.`;
  }
  return handler(parsed.args, deps);
}
