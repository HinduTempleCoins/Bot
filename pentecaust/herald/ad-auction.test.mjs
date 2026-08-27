// pentecaust/herald/ad-auction.test.mjs — offline. Second-price (Vickrey) auction for PREMIUM slots only.
// Asserts: premium-only guard (organic never auctioned), second-price clearing, reserve floor, single-bid →
// reserve, sealed re-bid replace, tie-break determinism, closed-auction refusal, design-only settlement,
// disclosed served unit + /go click-through, esc/XSS, unknown 404, never-throws-on-junk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdAuction, esc } from './ad-auction.mjs';

const mkClock = (start = 1000) => { let t = start; return { now: () => t, set: (v) => { t = v; }, add: (d) => { t += d; } }; };

test('openAuction refuses non-premium slot (organic ranking can never be bought)', () => {
  const a = createAdAuction();
  assert.equal(a.openAuction({ id: 'x', slotType: 'organic' }).ok, false);
  assert.equal(a.openAuction({ id: 'x', slotType: 'sponsored' }).ok, false);
  assert.equal(a.openAuction({ id: 'x', slotType: 'premium' }).ok, true);
});

test('openAuction validates id', () => {
  const a = createAdAuction();
  assert.equal(a.openAuction({ id: 'BAD ID!' }).ok, false);
  assert.equal(a.openAuction({ id: '' }).ok, false);
  assert.equal(a.openAuction({ id: 'home-hero' }).ok, true);
});

test('second-price: winner is highest bid, pays SECOND-highest', () => {
  const c = mkClock();
  const a = createAdAuction({ now: c.now });
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1, closesAt: 9999 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 5, creative: { code: 'acme-01', headline: 'Acme' } });
  a.placeBid({ auctionId: 'slot', advertiserId: 'globex', amount: 3 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'initech', amount: 2 });
  const r = a.settle('slot', 10000);
  assert.equal(r.ok, true);
  assert.equal(r.winner, 'acme');
  assert.equal(r.winningBid, 5);
  assert.equal(r.clearingPrice, 3); // pays the second-highest, not its own 5
  assert.equal(r.secondBid, 3);
});

test('reserve is the floor: single bid pays the reserve', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 2.5 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 10 });
  const r = a.settle('slot');
  assert.equal(r.winner, 'acme');
  assert.equal(r.clearingPrice, 2.5); // only bidder → pays reserve
});

test('reserve wins when second bid is below it', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 4 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'hi', amount: 10 });
  // a bid below reserve is refused entirely
  const low = a.placeBid({ auctionId: 'slot', advertiserId: 'lo', amount: 3 });
  assert.equal(low.ok, false);
  const r = a.settle('slot');
  assert.equal(r.clearingPrice, 4); // max(secondBid=0, reserve=4)
});

test('bids below reserve are refused', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 5 });
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'x', amount: 4 }).ok, false);
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'x', amount: 0 }).ok, false);
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'x', amount: -1 }).ok, false);
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'x', amount: 'junk' }).ok, false);
});

test('sealed re-bid replaces a bidder\'s earlier bid (no duplicate)', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 2 });
  const re = a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 8 });
  assert.equal(re.bidCount, 1); // replaced, not appended
  a.placeBid({ auctionId: 'slot', advertiserId: 'globex', amount: 6 });
  const r = a.settle('slot');
  assert.equal(r.winner, 'acme');
  assert.equal(r.clearingPrice, 6);
});

test('tie-break is deterministic: earliest bid wins the tie', () => {
  const c = mkClock(100);
  const a = createAdAuction({ now: c.now });
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1, closesAt: 9999 });
  c.set(100); a.placeBid({ auctionId: 'slot', advertiserId: 'zeta', amount: 5 });
  c.set(200); a.placeBid({ auctionId: 'slot', advertiserId: 'alpha', amount: 5 }); // same amount, later
  const r = a.settle('slot', 10000);
  assert.equal(r.winner, 'zeta');       // earliest at wins
  assert.equal(r.clearingPrice, 5);     // tie → second price equals winning price
});

test('closed auction refuses new bids', () => {
  const c = mkClock(100);
  const a = createAdAuction({ now: c.now });
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1, closesAt: 500 });
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'x', amount: 2 }).ok, true);
  c.set(600); // past closesAt
  assert.equal(a.placeBid({ auctionId: 'slot', advertiserId: 'y', amount: 3 }).ok, false);
});

test('no bids → no winner, settles cleanly', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium' });
  const r = a.settle('slot');
  assert.equal(r.ok, true);
  assert.equal(r.winner, null);
  assert.equal(r.clearingPrice, 0);
});

test('settle is idempotent + records a DESIGN-ONLY accrual (no funds move)', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 9 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'bcorp', amount: 4 });
  const r1 = a.settle('slot');
  const r2 = a.settle('slot');
  assert.equal(r2.alreadySettled, true);
  assert.equal(r1.clearingPrice, r2.clearingPrice);
  const led = a.accrualFor('slot');
  assert.equal(led.winner, 'acme');
  assert.equal(led.clearingPrice, 4);
  assert.match(led.settlement, /design-only/);
});

test('serve renders a disclosed premium unit with /go click-through', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 5, creative: { code: 'acme-01', headline: 'Buy Acme' } });
  a.settle('slot');
  const s = a.serve('slot');
  assert.equal(s.ok, true);
  assert.equal(s.slot, 'premium');
  assert.match(s.html, /\/go\/acme-01/);
  assert.match(s.html, /Sponsored/);
  assert.match(s.html, /rel="sponsored nofollow noopener"/);
  assert.match(s.html, /Buy Acme/);
});

test('serve escapes a hostile creative (XSS)', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'evil', amount: 5, creative: { code: 'evil-01', headline: '<script>alert(1)</script>', body: '"><img src=x>' } });
  a.settle('slot');
  const s = a.serve('slot');
  assert.ok(!s.html.includes('<script>alert(1)</script>'));
  assert.match(s.html, /&lt;script&gt;/);
  assert.ok(!s.html.includes('"><img src=x>'));
});

test('serve refuses before settle / with no winner', () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium' });
  assert.equal(a.serve('slot').ok, false); // not settled
  a.settle('slot'); // no bids
  assert.equal(a.serve('slot').ok, false); // no winner
});

test('esc escapes HTML-significant chars', () => {
  assert.equal(esc(`<b>"&'`), '&lt;b&gt;&quot;&amp;&#39;');
});

test('HTTP handler: /health, /api/auctions, /ad/premium, 404', async () => {
  const a = createAdAuction();
  a.openAuction({ id: 'slot', slotType: 'premium', reserve: 1 });
  a.placeBid({ auctionId: 'slot', advertiserId: 'acme', amount: 5, creative: { code: 'acme-01', headline: 'Hi' } });
  a.settle('slot');

  const call = (method, url) => new Promise((resolve) => {
    let sc = 0; let payload = '';
    const res = { writeHead(s) { sc = s; }, end(b) { payload = b || ''; resolve({ sc, payload }); } };
    a.handler({ method, url }, res);
  });

  let r = await call('GET', '/health');
  assert.equal(r.sc, 200);
  assert.equal(JSON.parse(r.payload).ok, true);

  r = await call('GET', '/api/auctions');
  assert.equal(JSON.parse(r.payload).auctions.length, 1);

  r = await call('GET', '/ad/premium?auction=slot');
  assert.match(r.payload, /acme-01/);

  r = await call('GET', '/nope');
  assert.equal(r.sc, 404);
});

test('junk inputs never throw', () => {
  const a = createAdAuction({ storage: 'nope' });
  assert.equal(a.openAuction(null).ok, false);
  assert.equal(a.placeBid(null).ok, false);
  assert.equal(a.placeBid({ auctionId: 'ghost', advertiserId: 'x', amount: 1 }).ok, false);
  assert.equal(a.settle(null).ok, false);
  assert.equal(a.settle('ghost').ok, false);
  assert.equal(a.serve(null).ok, false);
  assert.equal(a.getAuction('ghost'), null);
  assert.equal(a.accrualFor('ghost'), null);
  assert.deepEqual(a.listAuctions(), []);
});
