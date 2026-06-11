import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLine, splitRespectingQuotes } from './command-line-parse.mjs';

// ── splitRespectingQuotes ────────────────────────────────────────────────────
test('split: plain whitespace tokens', () => {
  assert.deepEqual(splitRespectingQuotes('a b  c'), ['a', 'b', 'c']);
});

test('split: double quotes group whitespace', () => {
  assert.deepEqual(splitRespectingQuotes('a "b c" d'), ['a', 'b c', 'd']);
});

test('split: single quotes group whitespace', () => {
  assert.deepEqual(splitRespectingQuotes("a 'b c' d"), ['a', 'b c', 'd']);
});

test('split: empty quoted token preserved', () => {
  assert.deepEqual(splitRespectingQuotes('a "" b'), ['a', '', 'b']);
});

test('split: unterminated quote consumes to end (soft-fail)', () => {
  assert.deepEqual(splitRespectingQuotes('a "b c'), ['a', 'b c']);
});

test('split: mixed quote chars stay literal inside the other', () => {
  assert.deepEqual(splitRespectingQuotes(`"it's fine"`), ["it's fine"]);
});

test('split: leading/trailing/tab/newline whitespace', () => {
  assert.deepEqual(splitRespectingQuotes('\t a\nb \r'), ['a', 'b']);
});

test('split: non-string -> []', () => {
  assert.deepEqual(splitRespectingQuotes(null), []);
  assert.deepEqual(splitRespectingQuotes(undefined), []);
  assert.deepEqual(splitRespectingQuotes(42), []);
});

// ── parseCommandLine: happy path ─────────────────────────────────────────────
test('parse: command + args + flags', () => {
  const r = parseCommandLine('!signup alice "New User" --email=a@b.co -v');
  assert.deepEqual(r, {
    command: 'signup',
    args: ['alice', 'New User'],
    flags: { email: 'a@b.co', v: true },
    raw: '!signup alice "New User" --email=a@b.co -v',
  });
});

test('parse: bare command', () => {
  assert.deepEqual(parseCommandLine('!help'), {
    command: 'help', args: [], flags: {}, raw: '!help',
  });
});

test('parse: command lowercased, args case preserved', () => {
  const r = parseCommandLine('!Witness Hathor');
  assert.equal(r.command, 'witness');
  assert.deepEqual(r.args, ['Hathor']);
});

test('parse: boolean long flag', () => {
  const r = parseCommandLine('!post --draft');
  assert.deepEqual(r.flags, { draft: true });
});

test('parse: --flag=value with equals in value', () => {
  const r = parseCommandLine('!set --url=https://x.io/a=b');
  assert.equal(r.flags.url, 'https://x.io/a=b');
});

test('parse: short flag cluster -> multiple booleans', () => {
  const r = parseCommandLine('!run -abc');
  assert.deepEqual(r.flags, { a: true, b: true, c: true });
});

test('parse: -k=v short flag with value', () => {
  const r = parseCommandLine('!run -n=5');
  assert.equal(r.flags.n, '5');
});

test('parse: leading whitespace tolerated, raw trimmed', () => {
  const r = parseCommandLine('   !ping   ');
  assert.equal(r.command, 'ping');
  assert.equal(r.raw, '!ping');
});

test('parse: custom multi-char prefix', () => {
  const r = parseCommandLine('//go fast', { prefix: '//' });
  assert.deepEqual(r, { command: 'go', args: ['fast'], flags: {}, raw: '//go fast' });
});

test('parse: quoted arg containing a dash is not a flag', () => {
  const r = parseCommandLine('!echo "--not-a-flag"');
  assert.deepEqual(r.args, ['--not-a-flag']);
  assert.deepEqual(r.flags, {});
});

test('parse: lone double-dash is a positional arg', () => {
  const r = parseCommandLine('!cmd -- tail');
  assert.deepEqual(r.args, ['--', 'tail']);
  assert.deepEqual(r.flags, {});
});

// ── parseCommandLine: soft-fail / edges ──────────────────────────────────────
test('parse: no prefix -> null', () => {
  assert.equal(parseCommandLine('hello world'), null);
});

test('parse: empty / whitespace-only -> null', () => {
  assert.equal(parseCommandLine(''), null);
  assert.equal(parseCommandLine('   '), null);
});

test('parse: bare prefix -> null', () => {
  assert.equal(parseCommandLine('!'), null);
  assert.equal(parseCommandLine('  !  '), null);
});

test('parse: non-string -> null (never throws)', () => {
  assert.equal(parseCommandLine(null), null);
  assert.equal(parseCommandLine(undefined), null);
  assert.equal(parseCommandLine(123), null);
  assert.equal(parseCommandLine({}), null);
});

test('parse: empty prefix option -> null (prefix required)', () => {
  assert.equal(parseCommandLine('!x', { prefix: '' }), null);
});

test('parse: prefix + quoted command uses unquoted content', () => {
  const r = parseCommandLine('!"x"');
  assert.equal(r.command, 'x');
});

test('parse: prefix + empty-quoted command -> null', () => {
  assert.equal(parseCommandLine('!""'), null);
});

test('parse: malformed --=value kept as positional, not lost', () => {
  const r = parseCommandLine('!cmd --=x');
  assert.deepEqual(r.args, ['--=x']);
  assert.deepEqual(r.flags, {});
});

test('parse: never throws on adversarial input', () => {
  const inputs = ['!', '!""', '!\t', '!a "b', '!--', '!-', '!a --=', '! "" '];
  for (const i of inputs) {
    assert.doesNotThrow(() => parseCommandLine(i));
  }
});
