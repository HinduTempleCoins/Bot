// donate-directory.test.mjs — OFFLINE. The lookup is injected; nothing here touches a network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  CAUSES, SOURCES, VERDICTS, cause, causeForNtee, sourceById,
  normalizeEin, isValidEin, formatEin, verifyOrg, donateButton, BUTTON_CSS, search, handler, esc,
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
