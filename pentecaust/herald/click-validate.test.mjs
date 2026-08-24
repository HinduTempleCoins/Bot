// pentecaust/herald/click-validate.test.mjs — offline suite for the billable-click / fraud-dedup pass.
//   node --test pentecaust/herald/click-validate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClicks, isCrawler, normHost, dedupBucketKey, payoutEligible, handler,
} from './click-validate.mjs';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_600_000_000_000; // fixed base ts (same 24h bucket)

const row = (o = {}) => ({ ts: T0, code: 'offer-01', ua: 'iPhone Safari', ref: 'melek.salon', ...o });

test('window dedup — same code+ua+refHost in one window counts once', () => {
  const clicks = [row(), row({ ts: T0 + 60_000 }), row({ ts: T0 + 120_000 })]; // 3 hits, same bucket
  const r = classifyClicks(clicks, { windowMs: DAY });
  assert.equal(r.raw, 3);
  assert.equal(r.billable, 1);
  assert.equal(r.dropped.duplicate, 2);
  assert.equal(r.byCode['offer-01'], 1);
});

test('a hit in the NEXT window bucket bills again (not a duplicate)', () => {
  const r = classifyClicks([row(), row({ ts: T0 + DAY + 1 })], { windowMs: DAY });
  assert.equal(r.billable, 2);
  assert.equal(r.dropped.duplicate, 0);
});

test('crawler / preview / empty user-agents are excluded from billable', () => {
  const clicks = [
    row({ ua: 'Googlebot/2.1' }),
    row({ ua: 'facebookexternalhit/1.1', ts: T0 + 1 }),
    row({ ua: 'curl/8.4.0', ts: T0 + 2 }),
    row({ ua: '', ts: T0 + 3 }),                 // empty UA — fail-closed
    row({ ua: 'ClaudeBot', ts: T0 + 4 }),
    row({ ua: 'Mozilla/5.0 (iPhone)', ts: T0 + 5 }), // one genuine human
  ];
  const r = classifyClicks(clicks, { windowMs: DAY });
  assert.equal(r.dropped.crawler, 5);
  assert.equal(r.billable, 1);
  assert.equal(isCrawler('Mozilla/5.0 (iPhone)'), false);
  assert.equal(isCrawler(''), true);
});

test('per-publisher origin allow-list — off-origin clicks log but do not pay', () => {
  const originsOf = { pubA: ['melek.salon', 'pool.soapbox.community'] };
  const clicks = [
    { ts: T0, code: 'c1', ua: 'iPhone', ref: 'melek.salon', publisherId: 'pubA' },        // ok
    { ts: T0, code: 'c1', ua: 'iPhone', ref: 'https://www.melek.salon/x', publisherId: 'pubA' }, // same host normalized → dup
    { ts: T0, code: 'c1', ua: 'Pixel', ref: 'evil.example.com', publisherId: 'pubA' },    // off-origin
  ];
  const r = classifyClicks(clicks, { windowMs: DAY, originsOf });
  assert.equal(r.dropped.offOrigin, 1);
  assert.equal(r.dropped.duplicate, 1);
  assert.equal(r.billable, 1);
  assert.equal(r.byPublisher.pubA, 1);
});

test('rate caps — overflow is quarantined (rateCapped), never billed', () => {
  const clicks = [
    row({ ua: 'iPhone' }),
    row({ ua: 'Android', ts: T0 + 1 }),   // distinct human → not a dup
    row({ ua: 'Firefox', ts: T0 + 2 }),   // distinct human → not a dup
  ];
  const r = classifyClicks(clicks, { windowMs: DAY, rateCaps: { perCode: 1 } });
  assert.equal(r.billable, 1);
  assert.equal(r.dropped.rateCapped, 2);
});

test('classification is deterministic + soft-fail on junk input', () => {
  assert.deepEqual(classifyClicks(null).dropped, { crawler: 0, offOrigin: 0, duplicate: 0, rateCapped: 0 });
  assert.equal(classifyClicks(null).billable, 0);
  assert.equal(classifyClicks([null, 42, {}]).ok, true);
});

test('normHost strips scheme / www / port / path', () => {
  assert.equal(normHost('https://www.Melek.Salon:8443/go/x?a=1'), 'melek.salon');
  assert.equal(normHost(''), '');
});

test('dedupBucketKey folds hits in the same window into one key', () => {
  assert.equal(dedupBucketKey(row(), DAY), dedupBucketKey(row({ ts: T0 + 500 }), DAY));
  assert.notEqual(dedupBucketKey(row(), DAY), dedupBucketKey(row({ ts: T0 + DAY + 1 }), DAY));
});

test('payoutEligible reuses sybilGate — fail-closed on unscored accounts', () => {
  const snapshot = [{ account: 'human', balance: 10 }, { account: 'sybil', balance: 10 }];
  const eligible = payoutEligible(snapshot, { scoreOf: { human: 1, sybil: 0 }, minScore: 1 });
  assert.deepEqual(eligible.map((e) => e.account), ['human']);
  assert.deepEqual(payoutEligible(null, {}), []); // soft-fail
});

test('handler POST /api/click-validate classifies serializable input', async () => {
  const req = { method: 'POST', url: '/api/click-validate', body: { clicks: [row(), row({ ts: T0 + 10 })], windowMs: DAY } };
  const cap = { code: 0, body: '' };
  const res = { writeHead(c) { cap.code = c; }, end(b) { cap.body = b; } };
  await handler(req, res);
  assert.equal(cap.code, 200);
  const out = JSON.parse(cap.body);
  assert.equal(out.billable, 1);
  assert.equal(out.dropped.duplicate, 1);
});
