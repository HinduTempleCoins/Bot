// backlinks.test.mjs — offline tests for the EARN-backlinks program (task #127).
// node:test, no network, no secrets. Run: node --test integrations/backlinks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPPORTUNITY_TYPES,
  BLACKLIST_SIGNALS,
  hasBlacklistSignal,
  classifyOpportunity,
  scoreOpportunity,
  buildOutreach,
  pipeline,
} from './backlinks.mjs';

test('OPPORTUNITY_TYPES has the seven earned categories, each with a why-legit note', () => {
  const expected = ['research-citation', 'guest-content', 'resource-page', 'directory-quality', 'digital-pr', 'broken-link-rebuild', 'data-study'];
  for (const k of expected) {
    assert.ok(Object.prototype.hasOwnProperty.call(OPPORTUNITY_TYPES, k), `missing type ${k}`);
    assert.equal(typeof OPPORTUNITY_TYPES[k], 'string');
    assert.ok(OPPORTUNITY_TYPES[k].length > 10, `note too short for ${k}`);
  }
  assert.equal(Object.keys(OPPORTUNITY_TYPES).length, expected.length);
});

test('classifyOpportunity APPROVES a genuine research-citation', () => {
  const v = classifyOpportunity({ type: 'research-citation', source: 'university.edu', notes: 'professor cites our crypto data study' });
  assert.equal(v.allowed, true);
  assert.equal(v.category, 'research-citation');
  assert.match(v.reason, /Approved/i);
});

test('classifyOpportunity REJECTS a "buy backlinks DA50 guaranteed" entry', () => {
  const v = classifyOpportunity({ type: 'guest-content', source: 'linkseller.biz', notes: 'buy backlinks DA50 guaranteed, pay for link' });
  assert.equal(v.allowed, false);
  assert.equal(v.category, null);
  assert.match(v.reason, /REJECTED/);
  assert.match(v.reason, /EARNED/i);
});

test('classifyOpportunity REJECTS an unknown type', () => {
  const v = classifyOpportunity({ type: 'mystery-type', source: 'somewhere.com' });
  assert.equal(v.allowed, false);
  assert.equal(v.category, null);
  assert.match(v.reason, /unknown opportunity type/i);
});

test('classifyOpportunity REJECTS missing/garbage input (soft-fail, no throw)', () => {
  assert.equal(classifyOpportunity().allowed, false);
  assert.equal(classifyOpportunity({}).allowed, false);
  assert.equal(classifyOpportunity({ type: '' }).allowed, false);
});

test('manipulation overrides even a valid-looking type', () => {
  // valid type, but the notes reveal it is paid → must still reject.
  const v = classifyOpportunity({ type: 'resource-page', source: 'site.com', notes: 'this is a paid link placement' });
  assert.equal(v.allowed, false);
});

test('BLACKLIST_SIGNALS catch PBN and link-exchange phrasing', () => {
  assert.ok(hasBlacklistSignal('We run a private blog network (PBN) for rankings'));
  assert.ok(hasBlacklistSignal('Interested in a link exchange?'));
  assert.ok(hasBlacklistSignal('reciprocal link swap, you link us we link you'));
  assert.ok(hasBlacklistSignal('5000 dofollow backlinks cheap'));
  assert.ok(hasBlacklistSignal('guaranteed DA60'));
  // genuine earned phrasing is NOT flagged
  assert.equal(hasBlacklistSignal('We would love to cite your original research'), false);
  assert.equal(hasBlacklistSignal('Please consider adding us to your resource page'), false);
});

test('BLACKLIST_SIGNALS is a non-empty array of RegExp', () => {
  assert.ok(Array.isArray(BLACKLIST_SIGNALS) && BLACKLIST_SIGNALS.length > 0);
  for (const re of BLACKLIST_SIGNALS) assert.ok(re instanceof RegExp);
});

test('scoreOpportunity is deterministic and in 0..100', () => {
  const opp = { type: 'research-citation', source: 'mit.edu/research', notes: 'professor citing our blockchain market data' };
  const a = scoreOpportunity(opp);
  const b = scoreOpportunity(opp);
  assert.equal(a, b); // deterministic
  assert.ok(Number.isInteger(a));
  assert.ok(a >= 0 && a <= 100);
});

test('scoreOpportunity returns 0 for a rejected/unknown opportunity', () => {
  assert.equal(scoreOpportunity({ type: 'mystery-type', source: 'x.com' }), 0);
  assert.equal(scoreOpportunity({ type: 'guest-content', notes: 'buy backlinks DA50 guaranteed' }), 0);
});

test('scoreOpportunity ranks a high-authority, relevant citation above a low-relevance directory', () => {
  const strong = scoreOpportunity({ type: 'research-citation', source: 'stanford.edu', relevance: 'high', notes: 'crypto data' });
  const weak = scoreOpportunity({ type: 'directory-quality', source: 'randomdir.net', relevance: 'low' });
  assert.ok(strong > weak);
});

test('buildOutreach includes a who-we-are disclosure and is plain text', () => {
  const msg = buildOutreach(
    { type: 'resource-page', source: 'cryptoblog.com/tools', notes: 'tools roundup' },
    { from: 'Hathor', site: 'https://data.soapbox.community' },
  );
  assert.equal(typeof msg, 'string');
  assert.match(msg, /Hathor/);                       // who we are (sender)
  assert.match(msg, /data\.soapbox\.community/);      // our site disclosed
  assert.match(msg, /honest outreach/i);             // explicit disclosure
  assert.match(msg, /not offering payment/i);        // no buying
  assert.match(msg, /not asking for a reciprocal link/i); // no exchange
  assert.ok(!/<[a-z]+>/i.test(msg));                 // no HTML tags
});

test('buildOutreach soft-fails with defaults when ctx omitted', () => {
  const msg = buildOutreach({ type: 'digital-pr', source: 'news.example.com' });
  assert.match(msg, /soapbox\.community/);
  assert.match(msg, /MELEK|SoapBox/);
});

test('pipeline drops rejected ones, sorts by score desc, and reports correct counts', () => {
  const input = [
    { type: 'research-citation', source: 'harvard.edu', relevance: 'high', notes: 'crypto data study' },
    { type: 'guest-content', source: 'spammy.biz', notes: 'buy backlinks DA50 guaranteed' }, // rejected
    { type: 'resource-page', source: 'blog.com/tools', relevance: 'low' },
    { type: 'mystery-type', source: 'x.com' }, // rejected
    { type: 'data-study', source: 'reuters.com', relevance: 'high', notes: 'original finance data' },
  ];
  const { opportunities, summary } = pipeline(input);
  assert.equal(summary.considered, 5);
  assert.equal(summary.rejected, 2);
  assert.equal(summary.allowed, 3);
  assert.equal(opportunities.length, 3);
  // sorted descending by score
  for (let i = 1; i < opportunities.length; i++) {
    assert.ok(opportunities[i - 1].score >= opportunities[i].score, 'not sorted desc');
  }
  // every survivor is an allowed earned category
  for (const o of opportunities) {
    assert.ok(Object.prototype.hasOwnProperty.call(OPPORTUNITY_TYPES, o.category));
  }
});

test('pipeline soft-fails on non-array input', () => {
  const r = pipeline(null);
  assert.deepEqual(r.summary, { considered: 0, allowed: 0, rejected: 0 });
  assert.deepEqual(r.opportunities, []);
});
