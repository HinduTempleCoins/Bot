// pentecaust/herald/ad-network.test.mjs — offline suite for the Herald ad-network core.
//   node --test pentecaust/herald/ad-network.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdNetwork, listAffiliateNetworks } from './ad-network.mjs';
import { getCampaign as qrGetCampaign } from './qr-tracker.mjs';
import { assertRankingUnbiased, rankListings } from '../../integrations/affiliate.mjs';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_600_000_000_000;

// In-memory fs so the shipped /go rail wiring touches no disk.
function memFs() {
  const box = { data: null };
  return { fs: { read: () => box.data, write: (_p, s) => { box.data = s; } }, file: '/mem/qr.json', box };
}
const mkNet = () => { const m = memFs(); return { net: createAdNetwork({ storage: {}, now: () => T0, fs: m.fs, file: m.file }), m }; };

test('first-dollar path — wires the /go rail + registers creative + campaign', () => {
  const { net, m } = mkNet();
  const fd = net.firstDollarCampaign({
    code: 'offer-01', network: 'impact', targetUrl: 'https://example.com/deal',
    publisherId: 'melek-salon', bidCpc: 0.25, label: 'Featured deal', clarity: 5, relevance: 4,
  });
  assert.equal(fd.ok, true);
  // The affiliate env id is unset in the test env → link soft-fails to a PLAIN url (never fabricated).
  assert.equal(fd.tracked, false);
  assert.equal(fd.configured, false);
  // The /go/{code} rail now resolves this campaign (proves the qr wiring, via injected fs).
  const camp = qrGetCampaign('offer-01', { fs: m.fs, file: m.file });
  assert.ok(camp);
  assert.equal(camp.landingUrl, 'https://example.com/deal');
  // creative + campaign are in the registries.
  assert.ok(net.getCreative('offer-01-cr'));
  assert.equal(net.getCreative('offer-01-cr').code, 'offer-01');
  assert.equal(net.getAdvertiser('impact').network, 'impact');
});

test('select — serves a disclosed unit whose click-through is /go/{code}', () => {
  const { net } = mkNet();
  net.firstDollarCampaign({ code: 'offer-01', network: 'impact', targetUrl: 'https://example.com/deal', bidCpc: 0.25, headline: 'Try it', clarity: 5, relevance: 5 });
  const r = net.select({ slot: 'sponsored', publisherId: 'melek-salon' });
  assert.equal(r.ok, true);
  assert.match(r.html, /\/go\/offer-01/);          // click-through on the shipped rail
  assert.match(r.html, /Sponsored/);               // labeled
  assert.match(r.html, /ftc-disclosure/);          // FTC disclosure always attached
});

test('ranking is NEVER bought — a higher bid does not outrank higher clarity', () => {
  const { net } = mkNet();
  // Two sponsored creatives: A bids far more but is less clear; B bids nothing but is clearer.
  net.registerCreative({ id: 'a-hi-bid', code: 'a', headline: 'A', clarity: 1, relevance: 1, bidCpc: 99, sponsored: true });
  net.registerCreative({ id: 'b-clear', code: 'b', headline: 'B', clarity: 9, relevance: 9, bidCpc: 0, sponsored: true });
  const r = net.select({ slot: 'sponsored' });
  assert.equal(r.ok, true);
  assert.equal(r.creative.id, 'b-clear');          // clarity wins, not the bid
});

test('select refuses a slot if the honest order was violated (assertRankingUnbiased is the moat)', () => {
  // Direct proof the guardrail throws when a sponsored item is placed above an organic one.
  const organic = [{ id: 'o', clarity: 5 }];
  const biased = [{ id: 's', sponsored: true }, { id: 'o', clarity: 5 }];
  assert.throws(() => assertRankingUnbiased(rankListings(organic), biased), /ranking bias/);
});

test('countValidatedClicks — a validated click accrues; dupes/bots/off-origin do not', () => {
  const { net } = mkNet();
  net.registerPublisher({ id: 'melek-salon', origins: ['melek.salon'], payout: 'token' });
  net.firstDollarCampaign({ code: 'offer-01', network: 'impact', targetUrl: 'https://example.com/deal', publisherId: 'melek-salon', bidCpc: 0.25 });

  const rawClicks = [
    { ts: T0, code: 'offer-01', ua: 'iPhone Safari', ref: 'melek.salon', publisherId: 'melek-salon' },  // billable
    { ts: T0 + 5, code: 'offer-01', ua: 'iPhone Safari', ref: 'melek.salon', publisherId: 'melek-salon' }, // dup
    { ts: T0 + 6, code: 'offer-01', ua: 'Android Chrome', ref: 'melek.salon', publisherId: 'melek-salon' }, // billable (distinct human)
    { ts: T0 + 7, code: 'offer-01', ua: 'Googlebot', ref: 'melek.salon', publisherId: 'melek-salon' },   // bot
    { ts: T0 + 8, code: 'offer-01', ua: 'Pixel', ref: 'evil.example.com', publisherId: 'melek-salon' },  // off-origin
  ];
  const r = net.countValidatedClicks({ code: 'offer-01', rawClicks, opts: { windowMs: DAY } });
  assert.equal(r.ok, true);
  assert.equal(r.billable, 2);
  assert.equal(r.validation.dropped.duplicate, 1);
  assert.equal(r.validation.dropped.crawler, 1);
  assert.equal(r.validation.dropped.offOrigin, 1);
  // accrual: 2 billable × 0.25 bid, attributed to the affiliate account (design-only settlement).
  assert.equal(r.accrual.billableClicks, 2);
  assert.equal(r.accrual.advertiserDebitUsd, 0.5);
  assert.match(r.accrual.attribution, /affiliate account/i);
  assert.match(r.accrual.settlement, /design-only/i);
  // second batch accumulates onto the same ledger.
  const r2 = net.countValidatedClicks({ code: 'offer-01', rawClicks: [{ ts: T0 + DAY + 1, code: 'offer-01', ua: 'iPhone Safari', ref: 'melek.salon', publisherId: 'melek-salon' }], opts: { windowMs: DAY } });
  assert.equal(r2.accrual.billableClicks, 3);
});

test('soft-fail on bad input; listAffiliateNetworks enumerates networks', () => {
  const { net } = mkNet();
  assert.equal(net.registerAdvertiser({}).ok, false);
  assert.equal(net.firstDollarCampaign({ code: 'x', network: 'impact', targetUrl: 'not-a-url' }).ok, false);
  assert.equal(net.select({}).ok, false); // no creatives
  const nets = listAffiliateNetworks();
  assert.ok(Array.isArray(nets) && nets.length > 0);
  assert.ok(nets.every((n) => 'configured' in n && 'key' in n));
});

test('handler GET /ad/select returns the served unit HTML', async () => {
  const { net } = mkNet();
  net.firstDollarCampaign({ code: 'offer-01', network: 'impact', targetUrl: 'https://example.com/deal', bidCpc: 0.1, headline: 'Hi', clarity: 3, relevance: 3 });
  const cap = { code: 0, headers: {}, body: '' };
  const res = { writeHead(c, h) { cap.code = c; cap.headers = h; }, end(b) { cap.body = b; } };
  await net.handler({ method: 'GET', url: '/ad/select?slot=sponsored' }, res);
  assert.equal(cap.code, 200);
  assert.match(cap.body, /\/go\/offer-01/);
});
