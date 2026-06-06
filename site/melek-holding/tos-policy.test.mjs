// tos-policy.test.mjs — offline tests for the alpha.melek.salon static ToS + Policy pages.
// These are plain static HTML served by the alpha web root (same pattern as the gate page),
// so there is nothing to import — we read the files from disk and assert:
//   1. both files exist and are non-trivial,
//   2. they are well-formed enough (balanced <tag>/</tag> counts; no stray unclosed elements),
//   3. they carry the load-bearing strings the build requires
//      (TESTS value-less, DRAFT, no banning, Cheetah credit-first),
//   4. they cross-link to each other and back to / and /trending.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TOS = join(here, 'tos', 'index.html');
const POLICY = join(here, 'policy', 'index.html');

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

for (const [label, path] of [['tos', TOS], ['policy', POLICY]]) {
  test(`${label}: file exists and is substantial`, () => {
    assert.ok(existsSync(path), `${path} should exist`);
    const html = readFileSync(path, 'utf8');
    assert.ok(html.length > 1500, `${label} page should be substantial HTML`);
  });

  test(`${label}: parses clean (balanced tags, well-formed shell)`, () => {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /^<!doctype html>/i, `${label}: has doctype`);
    assert.match(html, /<html[^>]*>[\s\S]*<\/html>\s*$/i, `${label}: html element closes`);
    assert.match(html, /<head>[\s\S]*<\/head>/i, `${label}: has head`);
    assert.match(html, /<body>[\s\S]*<\/body>/i, `${label}: has body`);
    checkBalanced(html, label);
  });

  test(`${label}: marked DRAFT, not in force`, () => {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /DRAFT/, `${label}: says DRAFT`);
    assert.match(html, /not in force/i, `${label}: says not in force`);
    assert.match(html, /counsel/i, `${label}: names counsel review`);
  });

  test(`${label}: TESTS is value-less`, () => {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /\bTESTS\b/, `${label}: mentions TESTS`);
    assert.match(html, /value-less test currency|has no value/i, `${label}: TESTS value-less`);
  });

  test(`${label}: cross-links to the sibling, /, and /trending`, () => {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /href="\//, `${label}: links back to /`);
    assert.match(html, /\/trending/, `${label}: links to /trending`);
    if (label === 'tos') assert.match(html, /\/policy\//, 'tos links to policy');
    if (label === 'policy') assert.match(html, /\/tos\//, 'policy links to tos');
  });

  test(`${label}: discloses AI residents (Hathor + Cheetah)`, () => {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /Hathor/, `${label}: names Hathor`);
    assert.match(html, /Cheetah/, `${label}: names Cheetah`);
  });
}

test('tos: non-custodial, no advice, MELEK is mainnet-only', () => {
  const html = readFileSync(TOS, 'utf8');
  assert.match(html, /non-custodial/i);
  assert.match(html, /never (transmitted|seen by|asks for|receive)/i);
  assert.match(html, /not medical, legal, or financial advice/i);
  assert.match(html, /\bMELEK\b/);
});

test('policy: no banning / no shadow-banning posture', () => {
  const html = readFileSync(POLICY, 'utf8');
  assert.match(html, /No banning|do <strong>not<\/strong> run a "ban"|not.{0,40}ban/i);
  assert.match(html, /shadow-ban/i);
});

test('policy: Cheetah is credit-first and does not accuse', () => {
  const html = readFileSync(POLICY, 'utf8');
  assert.match(html, /credit-first/i, 'policy: Cheetah credit-first');
  assert.match(html, /does not accuse|never an accuser/i, 'policy: Cheetah does not accuse');
});

test('policy: refuse service / preserve evidence / report; flag flow goes to Hathor resolution', () => {
  const html = readFileSync(POLICY, 'utf8');
  assert.match(html, /refuse service/i);
  assert.match(html, /preserve evidence/i);
  assert.match(html, /report to the proper authorities/i);
  assert.match(html, /resolution flow|reply to resolve/i);
});
