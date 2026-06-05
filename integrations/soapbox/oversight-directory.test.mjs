// oversight-directory.test.mjs — offline tests for the oversight/consumer-protection directory.
// No real network I/O: the live enrichers (oigReports / scrapeContact) are exercised through an
// injected fetch, so no real request or key is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTORY, CATEGORIES, CONTACT_FIELDS, AFFILIATE_SLOT, NOT_ADVICE,
  agencies, agency, whereToFile, whereToComplain, oigReports, scrapeContact, contactBlock, renderPage,
  __setFetch,
} from './oversight-directory.mjs';

// ── dataset shape ───────────────────────────────────────────────────────────────────────────────────
test('DIRECTORY — every entry carries the full contact schema incl. phone/email/fax/whoFor', () => {
  assert.ok(DIRECTORY.length >= 70, `seeded a real directory (${DIRECTORY.length})`);
  for (const e of DIRECTORY) {
    assert.ok(e.id && e.name, `id+name: ${e.id}`);
    assert.ok(CATEGORIES[e.category], `recognized category: ${e.id} -> ${e.category}`);
    // contact fields must be PRESENT (string), even if empty (= "not published")
    for (const f of CONTACT_FIELDS) {
      assert.equal(typeof e[f], 'string', `${e.id}.${f} is a string`);
    }
    assert.ok(e.filingUrl.startsWith('http'), `${e.id} has a filing URL`);
    assert.ok(e.source.startsWith('http'), `${e.id} cites a source URL`);
    assert.ok(e.whoFor.length > 0, `${e.id} states whoFor`);
  }
});

test('DIRECTORY — seeded per category: OIGs, consumer, ombudsman, 50+DC state AGs', () => {
  const count = (c) => DIRECTORY.filter((e) => e.category === c).length;
  assert.ok(count('oig') >= 10, `federal OIGs (${count('oig')})`);
  assert.ok(count('consumer') >= 4, `consumer (${count('consumer')})`);
  assert.ok(count('ombudsman') >= 3, `ombudsman (${count('ombudsman')})`);
  assert.equal(count('state-ag'), 51, 'all 50 states + DC AGs');
});

test('DIRECTORY — anchor offices present with their hotlines', () => {
  assert.equal(agency('hhs-oig').phone, '1-800-447-8477');
  assert.equal(agency('cfpb').filingUrl, 'https://www.consumerfinance.gov/complaint/');
  assert.equal(agency('ftc').filingUrl, 'https://reportfraud.ftc.gov/');
  assert.ok(agency('irs-taxpayer-advocate').whoFor.toLowerCase().includes('ombudsman'));
});

// ── agencies() filtering ──────────────────────────────────────────────────────────────────────────────
test('agencies() — filters by category', () => {
  const oigs = agencies({ category: 'oig' });
  assert.ok(oigs.length >= 10);
  assert.ok(oigs.every((e) => e.category === 'oig'));
});

test('agencies() — filters by state (per-state offices for that state + federal), excludes other states', () => {
  const ca = agencies({ state: 'CA' });
  // includes federal offices (state:null) and California's AG, excludes other states' AGs
  assert.ok(ca.some((e) => e.id === 'ag-ca'), 'includes CA AG');
  assert.ok(ca.some((e) => e.state === null), 'includes federal offices');
  assert.ok(!ca.some((e) => e.state && e.state !== 'CA'), 'excludes other states');
});

test('agencies() — state + category narrows to one state AG', () => {
  const tx = agencies({ category: 'state-ag', state: 'TX' });
  assert.equal(tx.length, 1);
  assert.equal(tx[0].id, 'ag-tx');
});

test('agencies() — free-text q searches name/whoFor/topics', () => {
  assert.ok(agencies({ q: 'medicare' }).some((e) => e.id === 'hhs-oig'));
  assert.ok(agencies({ q: 'robocall' }).some((e) => e.id === 'ftc'));
  assert.ok(agencies({ q: 'nursing home' }).some((e) => e.id === 'ltc-ombudsman'));
});

// ── agency() detail ─────────────────────────────────────────────────────────────────────────────────
test('agency() — returns full detail incl. all contact fields, or null', () => {
  const e = agency('cfpb');
  for (const f of CONTACT_FIELDS) assert.ok(f in e, `cfpb has ${f}`);
  assert.equal(e.phone, '1-855-411-2372');
  assert.equal(e.fax, '1-855-237-2392');
  assert.equal(agency('does-not-exist'), null);
});

// ── whereToFile() routing ─────────────────────────────────────────────────────────────────────────────
test('whereToFile() — routes a scam to the FTC', () => {
  const hits = whereToFile({ topic: 'scam' });
  assert.ok(hits.length > 0);
  assert.ok(hits.some((e) => e.id === 'ftc'), 'FTC routed for a scam');
});

test('whereToFile() — routes a bank/credit-card problem to the CFPB', () => {
  assert.ok(whereToFile({ topic: 'credit card' }).some((e) => e.id === 'cfpb'));
  assert.ok(whereToFile({ companyType: 'bank' }).some((e) => e.id === 'cfpb'));
});

test('whereToFile() — routes an unsafe product to CPSC and a car to NHTSA', () => {
  assert.ok(whereToFile({ topic: 'product safety' }).some((e) => e.id === 'cpsc'));
  assert.ok(whereToFile({ topic: 'car' }).some((e) => e.id === 'nhtsa'));
});

test('whereToFile() — with state prefers that state AG and excludes other states', () => {
  const hits = whereToFile({ topic: 'deceptive practice', state: 'NY' });
  assert.ok(hits.some((e) => e.id === 'ag-ny'), 'NY AG routed');
  assert.ok(!hits.some((e) => e.state && e.state !== 'NY'), 'no other-state AGs');
});

test('whereToFile() — unknown topic falls back to the general index (never empty)', () => {
  const hits = whereToFile({ topic: 'zxqv-nonsense-nomatch' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'usagov-consumer');
});

// ── whereToComplain() company hook ────────────────────────────────────────────────────────────────────
test('whereToComplain() — maps a company industry/type to the right office(s)', () => {
  assert.ok(whereToComplain({ name: 'Acme Bank', industry: 'banking' }).some((e) => e.id === 'cfpb'));
  assert.ok(whereToComplain({ name: 'Acme Motors', type: 'auto' }).some((e) => e.id === 'nhtsa'));
  assert.ok(whereToComplain('insurance').some((e) => e.id === 'naic-insurance'));
});

test('whereToComplain() — state-aware company routes to that state AG', () => {
  const hits = whereToComplain({ name: 'Local Shop', industry: 'retail', state: 'FL' });
  assert.ok(hits.some((e) => e.id === 'cpsc' || e.id === 'ag-fl'), 'product safety or FL AG');
  assert.ok(!hits.some((e) => e.state && e.state !== 'FL'), 'no other-state AGs');
});

test('whereToComplain() — never throws, returns an array even on junk input', () => {
  assert.ok(Array.isArray(whereToComplain(null)));
  assert.ok(Array.isArray(whereToComplain({})));
  assert.ok(Array.isArray(whereToComplain(123)));
});

// ── oigReports() live enrich (soft-fail) ──────────────────────────────────────────────────────────────
test('oigReports() — soft-fails to [] on a dead source', async () => {
  __setFetch(async () => ({ ok: false, status: 500 }));
  assert.deepEqual(await oigReports({ agency: 'HHS' }), []);
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await oigReports({ agency: 'VA' }), []);
  __setFetch(null);
});

test('oigReports() — parses oversight.gov payload via injected fetch', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      data: [
        { attributes: { title: 'Audit of X', agency_name: 'HHS', date_issued: '2026-01-02', report_url: 'https://oversight.gov/r/1' } },
      ],
    }),
  }));
  const out = await oigReports({ agency: 'HHS-fresh' }); // unique key to dodge cache
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Audit of X');
  assert.equal(out[0].url, 'https://oversight.gov/r/1');
  assert.equal(out[0].source, 'oversight.gov');
  __setFetch(null);
});

// ── scrapeContact() gap-filler (soft-fail) ────────────────────────────────────────────────────────────
test('scrapeContact() — extracts email/phone/fax from a page, soft-fails to empties', async () => {
  __setFetch(async () => ({
    ok: true,
    text: async () => 'Reach us: hotline@oig.example.gov  Phone: 1-800-111-2222  Fax: 202-333-4444',
  }));
  const c = await scrapeContact('https://example.gov/contact');
  assert.equal(c.email, 'hotline@oig.example.gov');
  assert.ok(c.phone.includes('800'));
  assert.ok(c.fax.includes('333'));

  __setFetch(async () => { throw new Error('boom'); });
  const empty = await scrapeContact('https://example.gov/x');
  assert.deepEqual(empty, { email: '', phone: '', fax: '', source: 'https://example.gov/x' });
  __setFetch(null);
});

// ── contactBlock() rendering ──────────────────────────────────────────────────────────────────────────
test('contactBlock() — renders Phone / Email / Fax / Who-it\'s-for / File-here, all escaped', () => {
  const html = contactBlock(agency('hhs-oig'));
  assert.match(html, /1-800-447-8477/);            // phone
  assert.match(html, /public\.affairs@oig\.hhs\.gov/); // email
  assert.match(html, /1-800-223-8164/);            // fax
  assert.match(html, /Who it's for/);              // whoFor label
  assert.match(html, /File a complaint here/);     // file-here link
  assert.match(html, /href="https:\/\/oig\.hhs\.gov\/fraud\/report-fraud\//); // filing url
});

test('contactBlock() — missing fields render as "not published", not dropped', () => {
  const html = contactBlock(agency('bbb')); // bbb has no phone/email/fax
  assert.match(html, /not published/);
});

test('contactBlock() — escapes hostile values', () => {
  const html = contactBlock({ id: 'x', name: '<script>alert(1)</script>', whoFor: 'a & b', filingUrl: 'https://x' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

// ── renderPage() + compliance surfaces ────────────────────────────────────────────────────────────────
test('renderPage() — renders the directory, the not-advice line, and the DISABLED affiliate note', () => {
  const html = renderPage({ results: agencies({ category: 'consumer' }) });
  assert.match(html, /oversight-directory/);
  assert.match(html, /Who it's for/);
  assert.ok(html.includes(NOT_ADVICE.slice(0, 30)), 'not-advice present');
  assert.match(html, /data-affiliate-enabled="false"/);
  assert.match(html, /flat-fee/i);
});

test('AFFILIATE_SLOT — disabled by default and flat-fee-only per ABA 5.4/7.2', () => {
  assert.equal(AFFILIATE_SLOT.enabled, false);
  assert.match(AFFILIATE_SLOT.model, /flat-fee/);
  assert.match(AFFILIATE_SLOT.note, /5\.4/);
  assert.match(AFFILIATE_SLOT.note, /7\.2/);
  assert.match(AFFILIATE_SLOT.note, /never a percentage/i);
});
