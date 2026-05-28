/**
 * commands/index.js — default-wired command dispatcher.
 *
 * Registers the built-in handlers against the default registry and exports
 * `dispatch()` as the single entry point: parse a body, route to a handler,
 * return its reply.
 *
 * Usage from a caller (e.g., a future comment-listener):
 *
 *   import { dispatch } from './commands/index.js';
 *   const result = await dispatch(commentBody, { adapter, askerAccount });
 *   if (result.handled) await adapter.reply({ ..., body: result.reply });
 *
 * Handlers can be added at runtime via `defaultRegistry.register(...)`.
 */

import { parseCommand } from './parser.js';
import { defaultRegistry, CommandNotFoundError } from './registry.js';
import { help } from './handlers/help.js';
import { balance } from './handlers/balance.js';
import { witness } from './handlers/witness.js';
import { postCount } from './handlers/post-count.js';

// Default registrations. Order doesn't matter; help lists them alphabetically.
defaultRegistry.register('help', {
  args: '[command]',
  help: 'Show available commands, or details for one command.',
  handler: help,
});
defaultRegistry.register('balance', {
  args: '@account',
  help: 'Show liquid MELEK + vesting shares for an account.',
  handler: balance,
});
defaultRegistry.register('witness', {
  args: '@account',
  help: 'Show witness record for an account: URL, signing key, missed blocks.',
  handler: witness,
});
defaultRegistry.register('post-count', {
  args: '@account',
  help: 'Show post/comment count and reputation for an account.',
  handler: postCount,
});

/**
 * High-level dispatch.
 *
 * @param {string} body       a comment body or transfer memo.
 * @param {object} [ctx]      handler context (adapter, askerAccount, etc).
 * @returns {Promise<{handled: boolean, reply?: string, error?: string, command?: string}>}
 */
export async function dispatch(body, ctx = {}) {
  const parsed = parseCommand(body);
  if (!parsed) return { handled: false };
  try {
    const result = await defaultRegistry.dispatch(parsed, ctx);
    return {
      handled: true,
      command: parsed.command,
      reply: result.reply,
      error: result.error,
      ok: result.ok,
    };
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      return {
        handled: true,
        command: parsed.command,
        ok: false,
        reply: `Unknown command: !${parsed.command}. Try !help.`,
      };
    }
    throw err;
  }
}

export { defaultRegistry };
