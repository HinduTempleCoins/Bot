// welcome.test.mjs — offline tests for the alpha.melek.salon new-user Welcome page.
// Plain static HTML served by the alpha web root (same pattern as the gate page), so there
// is nothing to import — we read the file from disk and assert:
//   1. the file exists and is substantial,
//   2. it is well-formed enough (balanced <tag>/</tag> counts; valid HTML shell),
//   3. it carries the load-bearing strings (Hathor, TESTS, a lorem-ipsum marker),
//   4. it reads the grant via the condenser /rpc call and uses no external <script src=>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WELCOME = join(here, 'welcome', 'index.html');

// Void elements that legitimately have no closing tag in HTML.
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype',
]);

// Simple well-formedness check: every non-void element that opens must close,
// with matching counts per tag name. Catches the common "unclosed tag" mistake
// without pulling in a full HTML parser.
function checkBalanced(html, label) {
  const tagRe = /<(\/?)([a-zA-Z!][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  const counts = new Map();
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const selfClosed = m[3] === '/';
    if (VOID.has(name) || selfClosed) continue;
    const cur = counts.get(name) || 0;
    counts.set(name, cur + (closing ? -1 : 1));
  }
  for (const [name, n] of counts) {
    assert.equal(n, 0, `${label}: tag <${name}> is unbalanced (open-minus-close = ${n})`);
  }
}

test('welcome: file exists and is substantial', () => {
  assert.ok(existsSync(WELCOME), `${WELCOME} should exist`);
  const html = readFileSync(WELCOME, 'utf8');
  assert.ok(html.length > 1500, 'welcome page should be substantial HTML');
});

test('welcome: parses clean (balanced tags, well-formed shell)', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /^<!doctype html>/i, 'welcome: has doctype');
  assert.match(html, /<html[^>]*>[\s\S]*<\/html>\s*$/i, 'welcome: html element closes');
  assert.match(html, /<head>[\s\S]*<\/head>/i, 'welcome: has head');
  assert.match(html, /<body>[\s\S]*<\/body>/i, 'welcome: has body');
  checkBalanced(html, 'welcome');
});

test('welcome: names Hathor as the founding AI Witness', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /Hathor/, 'welcome: names Hathor');
  assert.match(html, /founding AI Witness/i, 'welcome: credits the founding AI Witness');
});

test('welcome: explains TESTS is a value-less test currency', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /\bTESTS\b/, 'welcome: mentions TESTS');
  assert.match(html, /value-less test currency/i, 'welcome: TESTS value-less');
});

test('welcome: keys are the user\'s alone, site never holds them', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /recovery keys are yours alone/i, 'welcome: keys are the user\'s');
  assert.match(html, /never hold/i, 'welcome: site never holds keys');
});

test('welcome: has a lorem-ipsum placeholder marker', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /lorem ipsum/i, 'welcome: lorem-ipsum placeholder present');
});

test('welcome: reads the grant via the condenser /rpc call', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /fetch\(\s*['"]\/rpc['"]/, 'welcome: POSTs to /rpc');
  assert.match(html, /condenser_api\.get_accounts/, 'welcome: calls get_accounts');
  assert.match(html, /Your welcome grant:/, 'welcome: shows the grant line');
  assert.match(html, /your grant is on its way/i, 'welcome: friendly soft-fail');
});

test('welcome: esc() guards interpolation and there are no external scripts', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /function esc\(/, 'welcome: defines esc()');
  assert.ok(!/<script\s+src=/i.test(html), 'welcome: no <script src= (self-contained)');
});

test('welcome: links to feed, tutorial, and wallet', () => {
  const html = readFileSync(WELCOME, 'utf8');
  assert.match(html, /\/trending/, 'welcome: links to the feed');
  assert.match(html, /\/tutorial/, 'welcome: links to the tutorial');
  assert.match(html, /pool\.soapbox\.community\/wallet/, 'welcome: links to the wallet');
});
