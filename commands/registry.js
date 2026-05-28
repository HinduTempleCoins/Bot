/**
 * commands/registry.js — command name → handler dispatcher.
 *
 * A handler is an async function `(parsed, ctx) -> { ok, reply, error?, ... }`.
 *   parsed   ParsedCommand from commands/parser.js
 *   ctx      caller-supplied context: { adapter, logger, ... }
 *   reply    string the caller should post back to the user
 *
 * Registry is module-level singleton. Tests can pass a fresh registry via
 * `new Registry()` if needed.
 */

export class CommandNotFoundError extends Error {
  constructor(command) {
    super(`unknown command: !${command}`);
    this.command = command;
  }
}

export class Registry {
  constructor() {
    /** @type {Map<string, {handler: Function, help: string, args: string}>} */
    this._handlers = new Map();
  }

  /**
   * @param {string} name      command name (no leading `!`).
   * @param {{ help: string, args?: string, handler: Function }} entry
   */
  register(name, entry) {
    const key = name.toLowerCase();
    if (!entry?.handler || typeof entry.handler !== 'function') {
      throw new Error(`register("${name}"): handler must be a function`);
    }
    this._handlers.set(key, {
      handler: entry.handler,
      help: entry.help || '(no help)',
      args: entry.args || '',
    });
  }

  has(name) {
    return this._handlers.has(name.toLowerCase());
  }

  list() {
    return [...this._handlers.entries()].map(([name, e]) => ({
      name, args: e.args, help: e.help,
    }));
  }

  async dispatch(parsed, ctx = {}) {
    if (!parsed?.command) {
      return { ok: false, error: 'no command parsed' };
    }
    const entry = this._handlers.get(parsed.command);
    if (!entry) {
      throw new CommandNotFoundError(parsed.command);
    }
    return entry.handler(parsed, { ...ctx, registry: this });
  }
}

// ---- default singleton registry --------------------------------------------

export const defaultRegistry = new Registry();
