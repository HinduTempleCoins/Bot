/**
 * integrations/command-line-parse.mjs — low-level bang-command lexer.
 *
 * Pure tokenizer for the Phase-2 deterministic `!commands` / text-to-command
 * itinerary items. Deterministic, no network, no LLM, soft-fail (never throws).
 *
 * DISTINCT from commands/parser.js (the live dispatcher that maps a body to a
 * registered command and runs it). THIS is a reusable low-level lexer: it turns
 * one `!command arg "quoted arg" --flag --kv=value -x` line into a structured
 * shape and stays out of the dispatch/registry business entirely.
 *
 *   parseCommandLine('!signup alice "New User" --email=a@b.co -v', {prefix:'!'})
 *   => {
 *        command: 'signup',
 *        args: ['alice', 'New User'],
 *        flags: { email: 'a@b.co', v: true },
 *        raw: '!signup alice "New User" --email=a@b.co -v'
 *      }
 *
 * Returns null when the line is empty/non-string or lacks the prefix.
 */

/**
 * @typedef {object} ParsedLine
 * @property {string} command            lowercased command name (no prefix)
 * @property {string[]} args             positional, quote-respecting tokens
 * @property {Object<string,(string|boolean)>} flags  --flag / --flag=v / -x
 * @property {string} raw                the original (trimmed) line
 */

/**
 * Split a string into tokens, honoring "double" and 'single' quoted segments.
 * Quotes group whitespace; the surrounding quote characters are stripped.
 * Adjacent quoted/unquoted runs join into a single token (foo"bar baz" => one).
 * Unterminated quotes consume to end-of-string (soft-fail, never throws).
 *
 * @param {string} str
 * @returns {string[]}
 */
export function splitRespectingQuotes(str) {
  return tokenize(str).map((t) => t.value);
}

/**
 * Internal: tokenize into {value, quoted} records. `quoted` is true when any
 * part of the token came from inside quotes — used by parseCommandLine so a
 * quoted token (e.g. "--literal") is never mistaken for a flag.
 *
 * @param {string} str
 * @returns {{value:string, quoted:boolean}[]}
 */
function tokenize(str) {
  if (typeof str !== 'string') return [];
  const tokens = [];
  let cur = '';
  let inTok = false;  // whether we are mid-token (handles empty "" tokens)
  let quoted = false; // whether this token had any quoted part
  let quote = null;   // current quote char or null

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) {
        quote = null; // close quote; token continues
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inTok = true;
      quoted = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (inTok) {
        tokens.push({ value: cur, quoted });
        cur = '';
        inTok = false;
        quoted = false;
      }
      continue;
    }
    cur += ch;
    inTok = true;
  }
  if (inTok) tokens.push({ value: cur, quoted });
  return tokens;
}

/**
 * Tokenize a single bang-command line.
 *
 * @param {string} line
 * @param {{prefix?: string}} [opts]
 * @returns {ParsedLine|null}
 */
export function parseCommandLine(line, opts) {
  if (typeof line !== 'string') return null;
  const prefix = opts && typeof opts.prefix === 'string' ? opts.prefix : '!';

  const raw = line.trim();
  if (raw === '') return null;
  if (prefix === '') return null; // a real prefix is required
  if (!raw.startsWith(prefix)) return null;

  const body = raw.slice(prefix.length);
  const records = tokenize(body);
  if (records.length === 0) return null; // bare prefix, e.g. "!"

  const command = String(records[0].value).toLowerCase();
  if (command === '') return null; // prefix + empty-quoted command, e.g. !""

  const args = [];
  const flags = {};

  for (let i = 1; i < records.length; i++) {
    const t = records[i].value;
    if (records[i].quoted) {
      // a quoted token is literal content, never a flag
      args.push(t);
    } else if (t.startsWith('--') && t.length > 2) {
      const eq = t.indexOf('=');
      if (eq >= 0) {
        const key = t.slice(2, eq);
        const val = t.slice(eq + 1);
        if (key !== '') flags[key] = val;
        else args.push(t); // malformed "--=x": keep as positional, don't lose it
      } else {
        flags[t.slice(2)] = true;
      }
    } else if (t.startsWith('-') && t.length > 1 && t !== '--') {
      // short flag cluster: -v / -ab => {v:true} / {a:true,b:true} (boolean)
      const eq = t.indexOf('=');
      if (eq >= 0) {
        // -k=v : single-letter key with value
        const key = t.slice(1, eq);
        const val = t.slice(eq + 1);
        if (key !== '') flags[key] = val;
        else args.push(t);
      } else {
        for (const c of t.slice(1)) flags[c] = true;
      }
    } else {
      args.push(t);
    }
  }

  return { command, args, flags, raw };
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const line = process.argv.slice(2).join(' ');
  console.log(JSON.stringify(parseCommandLine(line), null, 2));
}
