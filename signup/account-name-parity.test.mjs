// account-name-parity.test.mjs — FINDING 5 (structural).
// node --test signup/account-name-parity.test.mjs
//
// validAccountName + SEGMENT_RE are copy-pasted in three places that must agree forever:
//   signup/account-create.mjs   (custody validator)
//   signup/faucet-testnet.mjs   (inlined so the faucet can deploy standalone — must NOT import the others)
//   signup/server.mjs           (read/compose validator)
// We deliberately do NOT refactor to one shared helper (the faucet's standalone constraint), so this
// test is the guard: it runs the SAME corpus of names through all three implementations and asserts
// IDENTICAL verdicts. A future divergence (someone tightens one copy, forgets another) fails here.
//
// Fully offline: pure function calls, no network, no env.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validAccountName as fromAccountCreate } from './account-create.mjs';
import { validAccountName as fromFaucet } from './faucet-testnet.mjs';
import { validAccountName as fromServer } from './server.mjs';

const IMPLS = [
  ['account-create.mjs', fromAccountCreate],
  ['faucet-testnet.mjs', fromFaucet],
  ['server.mjs', fromServer],
];

// A shared corpus exercising every rule edge: min/max length, per-segment length, the charset
// (SEGMENT_RE: lowercase start, [a-z0-9-] middle, lowercase/digit end), the no-double-dash rule,
// dotted (multi-segment) names, and non-string inputs.
const NAMES = [
  // — expected VALID —
  'abc',                 // min length 3
  'alice123',            // letters + digits
  'a-b-c',               // single dashes allowed
  'sixteenchars1234',    // exactly 16 (max)
  'foo.barbaz',          // dotted, each segment >= 3
  'a1b2c3',              // alternating
  'witness1',            // ends in a digit
  // — expected INVALID —
  'ab',                  // too short (2)
  'seventeenchars123',   // 17 chars (over 16)
  'Alice',               // uppercase not allowed
  '1abc',                // must start with a letter
  'abc-',                // trailing dash
  '-abc',                // leading dash
  'ab--cd',              // double dash banned
  'foo.ab',              // dotted but a segment < 3
  'foo..bar',            // empty middle segment
  'foo bar',             // space
  'foo_bar',             // underscore not in charset
  'foo.',                // trailing dot -> empty segment
  '.foo',                // leading dot -> empty segment
  '',                    // empty
  'a',                   // 1 char
  'this.is.way.too.long.a.name', // overall length > 16
];

test('all three validAccountName implementations agree on the full corpus', () => {
  for (const name of NAMES) {
    const verdicts = IMPLS.map(([, fn]) => fn(name));
    const allSame = verdicts.every((v) => v === verdicts[0]);
    assert.equal(
      allSame,
      true,
      `divergence on ${JSON.stringify(name)}: ${IMPLS.map(([label], i) => `${label}=${verdicts[i]}`).join(', ')}`,
    );
  }
});

test('all three agree on non-string inputs', () => {
  const bad = [undefined, null, 123, {}, [], true, Symbol('x')];
  for (const input of bad) {
    const verdicts = IMPLS.map(([, fn]) => {
      try { return fn(input); } catch { return 'threw'; }
    });
    const allSame = verdicts.every((v) => v === verdicts[0]);
    assert.equal(
      allSame,
      true,
      `divergence on ${String(input?.toString?.() ?? input)}: ${IMPLS.map(([label], i) => `${label}=${verdicts[i]}`).join(', ')}`,
    );
    // And every impl must reject (false), never accept or throw, on non-strings.
    assert.equal(verdicts[0], false, `non-string ${String(input)} should be rejected`);
  }
});

// Sanity: the corpus actually contains BOTH outcomes (so the parity test isn't trivially passing
// because, say, everything is rejected).
test('corpus contains both accepted and rejected names', () => {
  const results = NAMES.map((n) => fromFaucet(n));
  assert.ok(results.some((r) => r === true), 'at least one valid name in corpus');
  assert.ok(results.some((r) => r === false), 'at least one invalid name in corpus');
});
