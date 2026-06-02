// onramp-guide.test.mjs — guards for the "Americans into crypto" guide (task #178).
// Run: node --test integrations/soapbox/onramp-guide.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  US_EXCHANGES, FREE_EDUCATION, ZERO_COST_PATHS, STEPS, STORY, guide,
} from './onramp-guide.mjs';
import { usFriendly } from './markets-catalog.mjs';

test('every listed US exchange is genuinely US-friendly in the catalog', () => {
  const ok = new Set(usFriendly('crypto').map((e) => e.name));
  for (const x of US_EXCHANGES) {
    assert.ok(ok.has(x.name), `${x.name} must be us:'full'|'partial' in markets-catalog`);
  }
});

test('US exchanges have the required shape', () => {
  assert.ok(US_EXCHANGES.length >= 5);
  for (const x of US_EXCHANGES) {
    assert.equal(typeof x.name, 'string');
    assert.match(x.url, /^https:\/\//);
    assert.equal(typeof x.note, 'string');
    assert.equal(typeof x.custodial, 'boolean');
    assert.equal(typeof x.goodFor, 'string');
  }
});

test('free-education entries are well-formed', () => {
  assert.ok(FREE_EDUCATION.length >= 5);
  for (const e of FREE_EDUCATION) {
    assert.equal(typeof e.name, 'string');
    assert.match(e.url, /^https:\/\//);
    assert.ok(e.whatYouGet.length > 0);
  }
});

test('MELEK earn-by-posting is the prominent, flagship zero-cost path', () => {
  const flagship = ZERO_COST_PATHS.find((p) => p.flagship);
  assert.ok(flagship, 'a flagship zero-cost path must exist');
  assert.match(flagship.name, /MELEK/);
  assert.match(flagship.note, /\$0 to start/);
  // It must be listed first so a Learn page renders it on top.
  assert.equal(ZERO_COST_PATHS[0], flagship);
});

test('steps are a complete, ordered sequence and reach MELEK', () => {
  assert.ok(STEPS.length >= 5);
  STEPS.forEach((s, i) => assert.equal(s.step, i + 1));
  assert.ok(STEPS.some((s) => /MELEK/.test(s.detail)), 'the path must teach MELEK earn-by-posting');
});

test('guide() assembles, cross-checks the catalog, and carries a disclaimer', () => {
  const g = guide();
  assert.ok(g.story.length > 0);
  assert.match(g.disclaimer, /NOT financial advice/);
  assert.equal(g.meta.unverifiedAgainstCatalog.length, 0, 'no exchange should fail the catalog check');
  assert.ok(g.usExchanges.every((x) => x.catalogUsConfirmed === true));
  assert.match(g.meta.flagshipZeroCostPath, /MELEK/);
});

test('STORY frames it as $0-start, US, education-not-advice', () => {
  assert.match(STORY, /\$0/);
  assert.match(STORY, /MELEK/);
  assert.match(STORY, /not financial advice/i);
});
