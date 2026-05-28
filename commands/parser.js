/**
 * commands/parser.js — extract a `!command` invocation from a comment body
 * or transfer memo. Pure function, no I/O.
 *
 * Phase 2 design: deterministic, no LLM. The shape supports anything the
 * resident AI later wants to invoke, but the menu of valid commands is
 * fixed at registration time (see commands/registry.js).
 *
 * Convention: invocations start with `!` at the beginning of the body
 * (whitespace tolerated). Examples:
 *
 *   !help
 *   !balance @alice
 *   !witness hathor
 *
 * The first whitespace-separated token after `!` is the command name;
 * everything after is split on whitespace into args. The rest of the body
 * is returned as `rest` for handlers that want it (multi-line input).
 */

/**
 * @typedef {object} ParsedCommand
 * @property {string} command   lowercase, no leading `!`
 * @property {string[]} args    whitespace-split tokens after the command
 * @property {string} rest      remainder of the body after the first line
 * @property {string} raw       the original body
 */

const COMMAND_REGEX = /^\s*!([a-z][a-z0-9-]*)\b/i;

/**
 * @param {string|undefined|null} body
 * @returns {ParsedCommand|null}
 */
export function parseCommand(body) {
  if (!body || typeof body !== 'string') return null;
  const m = body.match(COMMAND_REGEX);
  if (!m) return null;
  const command = m[1].toLowerCase();

  // Take the first line for args; everything else is `rest`.
  const firstLineEnd = body.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? body : body.slice(0, firstLineEnd);
  const rest = firstLineEnd === -1 ? '' : body.slice(firstLineEnd + 1);

  // Strip the `!command` prefix from the first line, split remainder on
  // whitespace. Drop empty tokens.
  const afterCmd = firstLine.replace(COMMAND_REGEX, '').trim();
  const args = afterCmd ? afterCmd.split(/\s+/) : [];

  return { command, args, rest, raw: body };
}

/**
 * Normalize an account-name argument. Strips leading `@`, lowercases, and
 * trims. Returns null if the result is empty or contains characters that
 * are invalid in a Graphene account name.
 *
 * Graphene account names: 3-16 chars, lowercase a-z, 0-9, hyphens, must
 * start with a letter. Multiple segments separated by `.` are allowed.
 */
export function normalizeAccount(token) {
  if (typeof token !== 'string') return null;
  let s = token.trim().toLowerCase();
  if (s.startsWith('@')) s = s.slice(1);
  if (!s) return null;
  if (!/^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]{2,15})*$/.test(s)) return null;
  return s;
}
