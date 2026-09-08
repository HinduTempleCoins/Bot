// donate-directory.test.mjs — OFFLINE. The lookup is injected; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  CAUSES, SOURCES, VERDICTS, cause, causeForNtee, sourceById,
  normalizeEin, isValidEin, formatEin, verifyOrg, donateButton, BUTTON_CSS, search, handler, esc,
  DONOR_MODELS, feeBreakdown, checkoutEligibility, checkoutDisclosure,
} from './donate-directory.mjs';

const EIN = '13-1837418';
const org = { name: 'A Real Charity', donateUrl: 'https://realcharity.example/donate' };
const verified = { verdict: 'verified', ok: true, ein: EIN, deductible: true, checkedAt: '2026-09-08T00:00:00.000Z' };

// ── EINs ──────────────────────────────────────────────────────────────────────────────────────────
test('an EIN is nine digits, however it was typed', () => {
  assert.equal(normalizeEin('13-1837418'), '131837418');
  assert.equal(normalizeEin(' 13 183 7418 '), '131837418');
  assert.equal(isValidEin('13-1837418'), true);
  assert.equal(isValidEin('1318374'), false);
  assert.equal(isValidEin(''), false);
  assert.equal(formatEin('131837418'), '13-1837418');
  assert.equal(formatEin('nope'), '');
});

// ── verification: not-checked is the default ──────────────────────────────────────────────────────
test('with no lookup supplied nothing is verified — absence of a check is never a pass', async () => {
  const v = await verifyOrg({ ein: EIN });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.ok, false);
  assert.match(v.why, /no lookup/);
});

test('a bad EIN is unverified rather than an error', async () => {
  const v = await verifyOrg({ ein: 'not-an-ein' }, { lookup: async () => ({ exempt: true }) });
  assert.equal(v.verdict, 'unverified');
  assert.match(v.why, /nine-digit/);
});

test('a lookup that throws leaves it unverified, and says so — it never throws outward', async () => {
  const v = await verifyOrg({ ein: EIN }, { lookup: async () => { throw new Error('IRS timeout'); } });
  assert.equal(v.verdict, 'unverified');
  assert.match(v.why, /IRS timeout/);
});

test('a lookup that returns nothing is unverified', async () => {
  for (const bad of [null, undefined, 'a string']) {
    const v = await verifyOrg({ ein: EIN }, { lookup: async () => bad });
    assert.equal(v.verdict, 'unverified', String(bad));
  }
});

test('an exempt, unrevoked organisation verifies, and carries the date it was checked', async () => {
  const v = await verifyOrg({ ein: EIN }, {
    lookup: async () => ({ exempt: true, deductible: true, revoked: false, name: 'A Real Charity', subsection: '501(c)(3)' }),
    now: () => new Date('2026-09-08T12:00:00Z'),
  });
  assert.equal(v.verdict, 'verified');
  assert.equal(v.deductible, true);
  assert.equal(v.checkedAt, '2026-09-08T12:00:00.000Z');
  assert.deepEqual(v.sources, ['irs-teos', 'irs-revocation']);
});

test('REVOCATION is checked before exemption — a stale master file still says exempt', async () => {
  const v = await verifyOrg({ ein: EIN }, {
    lookup: async () => ({ exempt: true, deductible: true, revoked: true, name: 'Lapsed Charity' }),
  });
  assert.equal(v.verdict, 'revoked', 'exempt:true must not override revoked:true');
  assert.equal(v.deductible, false);
});

test('an EIN with no exempt record is not-exempt, which is not the same as unverified', async () => {
  const v = await verifyOrg({ ein: EIN }, { lookup: async () => ({ exempt: false }) });
  assert.equal(v.verdict, 'not-exempt');
  assert.notEqual(v.verdict, 'unverified');
});

test('exempt but not deductible is a real state and is carried honestly', async () => {
  const v = await verifyOrg({ ein: EIN }, { lookup: async () => ({ exempt: true, deductible: false, revoked: false }) });
  assert.equal(v.verdict, 'verified');
  assert.equal(v.deductible, false);
});

// ── the button cannot be made to lie ──────────────────────────────────────────────────────────────
test('a verified organisation gets a button that names the EIN and the check date', () => {
  const b = donateButton(org, verified);
  assert.equal(b.ok, true);
  assert.match(b.html, /realcharity\.example\/donate/);
  assert.match(b.html, /13-1837418/);
  assert.match(b.html, /tax-deductible/);
  assert.match(b.html, /2026-09-08/);
});

test('an UNVERIFIED organisation gets no button at all — there is no option to force one', () => {
  const b = donateButton(org, { verdict: 'unverified', why: 'no check ran' });
  assert.equal(b.ok, false);
  assert.equal(b.code, 'unverified');
  assert.equal(b.html, '', 'no markup means nothing can be pasted anywhere');
  // and the same with no verification argument at all
  assert.equal(donateButton(org).html, '');
});

test('a REVOKED organisation renders a warning, not a call to action', () => {
  const b = donateButton(org, { verdict: 'revoked', ein: EIN });
  assert.equal(b.ok, false);
  assert.match(b.html, /automatically revoked/);
  assert.ok(!/sb-donate-btn/.test(b.html), 'a revoked org must never render a donate CTA');
  assert.match(b.html, /apps\.irs\.gov/, 'and it points the donor at the IRS record');
});

test('a non-deductible verified organisation says so plainly on the button', () => {
  const b = donateButton(org, { ...verified, deductible: false });
  assert.equal(b.ok, true);
  assert.match(b.html, /does NOT show contributions/);
});

test('a donation link must be https — no link, or plain http, renders nothing', () => {
  assert.equal(donateButton({ name: 'X', donateUrl: 'http://insecure.example/give' }, verified).code, 'no-https-url');
  assert.equal(donateButton({ name: 'X' }, verified).code, 'no-https-url');
  assert.equal(donateButton({ donateUrl: 'https://x.example' }, verified).code, 'no-name');
});

test('the button escapes everything it interpolates', () => {
  const b = donateButton({ name: '<script>x</script>', donateUrl: 'https://x.example/"onerror="' }, verified);
  assert.ok(!b.html.includes('<script>'));
  assert.ok(!b.html.includes('"onerror="'));
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
});

test('compact mode drops the footnote but keeps the link', () => {
  const b = donateButton(org, verified, { compact: true });
  assert.equal(b.ok, true);
  assert.ok(!/sb-donate-note/.test(b.html));
  assert.match(b.html, /realcharity\.example/);
});

// ── discovery ─────────────────────────────────────────────────────────────────────────────────────
const ORGS = [
  { name: 'North Texas Food Bank', ntee: 'K31', state: 'TX', city: 'Plano' },
  { name: 'Zeta Arts Collective', ntee: 'A20', state: 'TX', city: 'Dallas', verification: { verdict: 'verified' } },
  { name: 'Alpha Arts Trust', ntee: 'A20', state: 'CA', city: 'Oakland' },
];

test('search filters by cause, state and free text', () => {
  assert.deepEqual(search(ORGS, { causeId: 'food' }).map((o) => o.name), ['North Texas Food Bank']);
  assert.deepEqual(search(ORGS, { state: 'CA' }).map((o) => o.name), ['Alpha Arts Trust']);
  assert.deepEqual(search(ORGS, { q: 'plano' }).map((o) => o.name), ['North Texas Food Bank']);
  assert.equal(search(ORGS, { q: 'nothing here' }).length, 0);
});

test('verified organisations sort first — a statement of what was checked, not of worth', () => {
  const r = search(ORGS, { causeId: 'arts' });
  assert.deepEqual(r.map((o) => o.name), ['Zeta Arts Collective', 'Alpha Arts Trust'],
    'Zeta sorts before Alpha only because it is verified');
});

test('search survives junk rows and an empty list', () => {
  assert.deepEqual(search([null, {}, { name: '' }], {}), []);
  assert.deepEqual(search([], {}), []);
  assert.equal(search(ORGS, { limit: 1 }).length, 1);
});

test('causes map onto real NTEE letters, and back', () => {
  assert.equal(cause('food').ntee.includes('K'), true);
  assert.equal(causeForNtee('K31').id, 'food');
  assert.equal(causeForNtee('A20').id, 'arts');
  assert.equal(cause('nope'), null);
  assert.equal(causeForNtee(''), null);
  assert.ok(CAUSES.every((c) => c.id && c.name && c.ntee.length));
});

// ── the boundary ──────────────────────────────────────────────────────────────────────────────────
test('every source is first-party and keyless, and the aggregator is not a source of truth', () => {
  assert.ok(SOURCES.every((s) => s.url.startsWith('https://')));
  assert.ok(SOURCES.filter((s) => s.id.startsWith('irs-')).length >= 3);
  assert.match(sourceById('propublica-990').what, /NOT a substitute/);
  assert.equal(sourceById('nope'), null);
});

test('the handler states plainly that we never take the money', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.weTakeNoMoney, /own donation page/);
  assert.equal(Object.keys(j.verdicts).length, Object.keys(VERDICTS).length);
  assert.ok(BUTTON_CSS.includes('.sb-donate-btn'));
});


// ── giving at checkout ────────────────────────────────────────────────────────────────────────────
test('the platform fee is taken from the DONATION, never from the merchant\'s sale', () => {
  const b = feeBreakdown({ saleAmount: 100, donationAmount: 10, platformBps: 100 });
  assert.equal(b.sale, 100, 'the sale is untouched');
  assert.equal(b.platformFee, 0.10, '1% of the $10 gift, not of the $110 charge');
  assert.equal(b.charityReceives, 9.65);
  assert.equal(b.donorPays, 110);
});

test('when the donor covers fees the charity receives the whole gift', () => {
  const b = feeBreakdown({ saleAmount: 100, donationAmount: 10, platformBps: 100, donorCoversFees: true });
  assert.equal(b.charityReceives, 10);
  assert.equal(b.donorPays, 110.35);
  assert.match(b.note, /receives the full gift/);
});

test('a zero donation is not a transaction', () => {
  const b = feeBreakdown({ saleAmount: 100, donationAmount: 0 });
  assert.equal(b.ok, false);
  assert.equal(b.charityReceives, 0);
  assert.equal(b.donorPays, 100);
});

test('the processor cost charged to the gift is its share, not the whole fixed fee', () => {
  // A 30c fixed fee on a $110 charge must not be billed entirely to a $10 donation.
  const b = feeBreakdown({ saleAmount: 100, donationAmount: 10 });
  assert.ok(b.processorFee < 0.30, `gift bore ${b.processorFee} of the fixed fee`);
});

test('a zero platform fee is honoured — free is a supported configuration', () => {
  const b = feeBreakdown({ saleAmount: 50, donationAmount: 5, platformBps: 0 });
  assert.equal(b.platformFee, 0);
});

test('money never drifts into fractions of a cent', () => {
  for (const [s, d] of [[19.99, 0.01], [33.33, 3.33], [0, 7.77]]) {
    const b = feeBreakdown({ saleAmount: s, donationAmount: d, platformBps: 250 });
    for (const k of ['charityReceives', 'donorPays', 'processorFee', 'platformFee']) {
      // Compare with a tolerance: 36.66 * 100 is 3665.9999999999995 in binary floating point, so an
      // exact equality here would fail on values that ARE whole cents.
      assert.ok(Math.abs(b[k] * 100 - Math.round(b[k] * 100)) < 1e-6, `${k}=${b[k]} for ${s}/${d}`);
    }
  }
});

// ── the co-venture fork ───────────────────────────────────────────────────────────────────────────
test('"we donate 1% of every sale" is flagged as a commercial co-venture, with what it requires', () => {
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, verified, { model: 'merchant' });
  assert.equal(e.coVenture, true);
  assert.ok(e.mustDoFirst.some((n) => /co-venture registration/i.test(n)));
  assert.ok(e.mustDoFirst.some((n) => /bond/i.test(n)), 'NY/MA/AL/SC bonding must be named');
  assert.ok(e.mustDoFirst.some((n) => /written contract/i.test(n)));
});

test('a customer-opt-in donation is not a co-venture', () => {
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, verified, { model: 'customer' });
  assert.equal(e.coVenture, false);
  assert.equal(e.ok, true);
});

// ── the check that makes it worth paying for ──────────────────────────────────────────────────────
test('a revoked charity cannot be placed in a checkout, and the reason names the merchant\'s exposure', () => {
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, { verdict: 'revoked' });
  assert.equal(e.ok, false);
  assert.ok(e.problems.some((p) => /vouching/.test(p)));
});

test('an unverified charity cannot be placed in a checkout either', () => {
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, { verdict: 'unverified' });
  assert.equal(e.ok, false);
  assert.ok(e.problems.some((p) => /requires a current check/.test(p)));
});

test('verification GOES STALE — revocation happens after you integrate', () => {
  const old = { ...verified, checkedAt: '2026-01-01T00:00:00.000Z' };
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, old, { now: () => new Date('2026-09-08T00:00:00Z') });
  assert.equal(e.ok, false);
  assert.ok(e.problems.some((p) => /last checked \d+ days ago/.test(p)));
  assert.equal(e.recheckEvery, '30 days');
});

test('a fresh check inside the window passes', () => {
  const fresh = { ...verified, checkedAt: '2026-09-01T00:00:00.000Z' };
  const e = checkoutEligibility({ donateUrl: 'https://c.example/give' }, fresh, { now: () => new Date('2026-09-08T00:00:00Z') });
  assert.equal(e.ok, true);
});

test('a charity with no https destination cannot be placed', () => {
  const e = checkoutEligibility({ donateUrl: 'http://c.example/give' }, verified);
  assert.equal(e.ok, false);
  assert.ok(e.problems.some((p) => /https/.test(p)));
});

// ── disclosure ────────────────────────────────────────────────────────────────────────────────────
test('the customer disclosure says it is a donation, names the net, and says who receipts', () => {
  const b = feeBreakdown({ saleAmount: 100, donationAmount: 10, platformBps: 100 });
  const d = checkoutDisclosure({ name: 'A Real Charity' }, b);
  assert.match(d, /donation, not part of your purchase/);
  assert.match(d, /\$9\.65/);
  assert.match(d, /receipt for the donation comes from the organisation/);
});

test('the merchant disclosure says the customer is not being charged extra', () => {
  const d = checkoutDisclosure({ name: 'A Real Charity' }, {}, { model: 'merchant' });
  assert.match(d, /not an additional charge to you/);
});

test('the disclosure escapes the charity name', () => {
  const d = checkoutDisclosure({ name: '<script>x</script>' }, { donation: 1, charityReceives: 1 });
  assert.ok(!d.includes('<script>'));
});

test('both donor models are described, and only one is a co-venture', () => {
  assert.equal(DONOR_MODELS.customer.coVenture, false);
  assert.equal(DONOR_MODELS.merchant.coVenture, true);
  assert.ok(Object.values(DONOR_MODELS).every((m) => m.what && Array.isArray(m.needs)));
});
