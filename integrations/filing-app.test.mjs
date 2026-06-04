// filing-app.test.mjs — tests for the Business & Civic Filing App core (task #213).
// Offline, deterministic (injectable clock). node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANNER,
  FEE_PAID_BY_USER,
  FILINGS,
  getFiling,
  intake,
  generateDraft,
  complianceCalendar,
  boiStatus,
  renderForm,
} from './filing-app.mjs';

// ---------------------------------------------------------------------------
// FILINGS catalog
// ---------------------------------------------------------------------------

test('FILINGS includes EIN / 990 / 1023-EZ / TX formation / PIR / DBA', () => {
  const ids = new Set(FILINGS.map((x) => x.id));
  assert.ok(ids.has('ein'), 'EIN');
  assert.ok(ids.has('990'), '990');
  assert.ok(ids.has('990-ez'), '990-EZ');
  assert.ok(ids.has('1023-ez'), '1023-EZ');
  assert.ok(ids.has('tx-llc-formation') || ids.has('tx-nonprofit-formation'), 'TX formation');
  assert.ok(ids.has('tx-franchise-pir'), 'TX franchise/PIR');
  assert.ok(ids.has('dba'), 'DBA');
  assert.ok(ids.has('reinstatement') || ids.has('tx-reinstatement'), 'reinstatement');
  assert.ok(ids.has('registered-agent'), 'registered-agent');
  assert.ok(ids.has('annual-report'), 'annual report');
});

test('every filing fee is paid-to-state-by-user (no client funds collected)', () => {
  for (const x of FILINGS) {
    assert.equal(x.fee, FEE_PAID_BY_USER, `${x.id} fee must be paid by user`);
  }
});

test('every filing has the required shape', () => {
  for (const x of FILINGS) {
    assert.ok(x.id && typeof x.id === 'string', `${x.id} id`);
    assert.ok(x.name, `${x.id} name`);
    assert.ok(x.jurisdiction, `${x.id} jurisdiction`);
    assert.ok(x.form, `${x.id} form`);
    assert.ok(Array.isArray(x.fields) && x.fields.length, `${x.id} fields`);
    assert.ok(typeof x.template === 'string', `${x.id} template`);
    assert.ok(x.source, `${x.id} source`);
  }
});

test('TX and federal jurisdictions are both represented', () => {
  const j = new Set(FILINGS.map((x) => x.jurisdiction));
  assert.ok(j.has('TX'));
  assert.ok(j.has('federal'));
});

// ---------------------------------------------------------------------------
// intake
// ---------------------------------------------------------------------------

test('intake returns the field list for a filing', () => {
  const w = intake('ein');
  assert.equal(w.ok, true);
  assert.equal(w.filingId, 'ein');
  assert.ok(Array.isArray(w.fields) && w.fields.length > 0);
  assert.ok(w.fields.every((f) => f.key && f.label));
  assert.equal(w.fee, FEE_PAID_BY_USER);
  assert.ok(w.banner.includes('not a law firm') || /not a law firm/i.test(w.banner));
});

test('intake soft-fails on an unknown filing', () => {
  const w = intake('does-not-exist');
  assert.equal(w.ok, false);
  assert.match(w.reason, /unknown filing/i);
});

test('getFiling returns null for unknown id', () => {
  assert.equal(getFiling('nope'), null);
  assert.equal(getFiling('ein').id, 'ein');
});

// ---------------------------------------------------------------------------
// generateDraft
// ---------------------------------------------------------------------------

test('generateDraft fills the template and carries the not-advice banner', () => {
  const d = generateDraft('ein', {
    legalName: 'Shaivite Temple',
    entityType: 'nonprofit',
    responsibleParty: 'Jane Doe',
    responsiblePartyTin: '000-00-0000',
    mailingAddress: '1 Temple Rd, Dallas TX',
    reasonForApplying: 'started new organization',
  });
  assert.equal(d.ok, true);
  assert.ok(d.body.includes('Shaivite Temple'), 'answer filled into body');
  assert.ok(d.body.includes(BANNER), 'banner present in body verbatim');
  assert.match(d.banner, /not a law firm/i);
  assert.match(d.banner, /not legal advice/i);
});

test('generateDraft rejects missing required fields', () => {
  const d = generateDraft('ein', { legalName: 'Shaivite Temple' }); // missing several required
  assert.equal(d.ok, false);
  assert.ok(Array.isArray(d.missing) && d.missing.length > 0);
  assert.match(d.reason, /missing required field/i);
  assert.ok(d.missing.includes('responsibleParty'));
});

test('generateDraft has NO payment path — paymentStep:false, no collection text, fee paid by user', () => {
  const d = generateDraft('tx-llc-formation', {
    entityName: 'Example LLC',
    registeredAgent: 'Agent Co',
    registeredAgentAddress: '5 Main St, Austin TX',
    management: 'member-managed',
    organizer: 'Org Person',
  });
  assert.equal(d.ok, true);
  assert.equal(d.paymentStep, false);
  assert.equal(d.autoEfile, false);
  assert.equal(d.fee, FEE_PAID_BY_USER);
  // The body must instruct the user to pay the agency directly, never collect payment.
  assert.ok(d.body.includes(FEE_PAID_BY_USER), 'fee tagged paid-to-state-by-user');
  // Check the filled draft excluding the fixed banner (which deliberately says we do NOT
  // hold funds) for any payment-collection instruction.
  const draftWithoutBanner = d.body.replace(BANNER, '');
  assert.doesNotMatch(draftWithoutBanner, /\b(pay us|pay here|pay now|enter (your )?card|checkout|add to cart|we will charge|escrow|hold your funds)\b/i);
  assert.match(d.body, /file (it )?yourself|you pay the agency directly|does not file for you/i);
});

test('generateDraft soft-fails on unknown filing and bad answers object', () => {
  assert.equal(generateDraft('nope', {}).ok, false);
  // null answers must not throw — treated as empty → missing required.
  const d = generateDraft('ein', null);
  assert.equal(d.ok, false);
  assert.ok(d.missing.length > 0);
});

test('optional fields left blank render as a placeholder, not a crash', () => {
  const d = generateDraft('tx-llc-formation', {
    entityName: 'Example LLC',
    registeredAgent: 'Agent Co',
    registeredAgentAddress: '5 Main St, Austin TX',
    management: 'member-managed',
    organizer: 'Org Person',
    // purpose omitted (optional)
  });
  assert.equal(d.ok, true);
  assert.ok(d.body.includes('[not provided]'), 'optional purpose shows placeholder');
});

// ---------------------------------------------------------------------------
// complianceCalendar
// ---------------------------------------------------------------------------

test('complianceCalendar lists annual deadlines + the BOI note', () => {
  const cal = complianceCalendar({
    entity: { name: 'Shaivite Temple', fiscalYearEnd: '2025-12-31', type: 'domestic' },
    now: '2026-06-04',
  });
  assert.ok(Array.isArray(cal.deadlines) && cal.deadlines.length > 0);

  // TX PIR (fixed May 15) should be present and annual.
  const pir = cal.deadlines.find((d) => d.filingId === 'tx-franchise-pir');
  assert.ok(pir, 'PIR present');
  assert.equal(pir.cadence, 'annual');
  assert.ok(pir.dueAt, 'PIR has a computed due date');

  // 990 (fiscal-anchored) should be present and dated from the FYE.
  const f990 = cal.deadlines.find((d) => d.filingId === '990');
  assert.ok(f990, '990 present');
  assert.ok(f990.dueAt, '990 dated from FYE');

  // BOI monitoring note present.
  assert.ok(cal.boi, 'BOI block present');
  assert.equal(cal.boi.status, 'exempt');
  assert.match(cal.boi.note, /BOI|Beneficial Ownership/i);
  assert.match(cal.banner, /not a law firm/i);
});

test('complianceCalendar sorts by soonest due date', () => {
  const cal = complianceCalendar({
    entity: { fiscalYearEnd: '2025-12-31', type: 'domestic' },
    now: '2026-06-04',
  });
  const dated = cal.deadlines.filter((d) => d.dueAt).map((d) => d.dueAt);
  const sorted = [...dated].sort();
  assert.deepEqual(dated, sorted, 'deadlines are in ascending date order');
});

test('complianceCalendar PIR due date rolls to next year when now is past May 15', () => {
  const cal = complianceCalendar({ now: '2026-06-01', filings: ['tx-franchise-pir'] });
  const pir = cal.deadlines.find((d) => d.filingId === 'tx-franchise-pir');
  // now = 2026-06-01 is after May 15 2026, so the next PIR deadline is May 15 2027.
  assert.equal(pir.dueAt, new Date(Date.UTC(2027, 4, 15)).toISOString());
});

test('complianceCalendar handles a foreign entity (BOI reporting required)', () => {
  const cal = complianceCalendar({ entity: { type: 'foreign' }, now: '2026-06-04' });
  assert.equal(cal.boi.status, 'reporting-required');
  assert.equal(cal.boi.reportingRequired, true);
});

// ---------------------------------------------------------------------------
// boiStatus
// ---------------------------------------------------------------------------

test('boiStatus says domestic entities are exempt', () => {
  const s = boiStatus({ entityType: 'domestic' });
  assert.equal(s.entityType, 'domestic');
  assert.equal(s.status, 'exempt');
  assert.equal(s.reportingRequired, false);
  assert.match(s.note, /exempt/i);
  assert.match(s.source, /FinCEN/i);
});

test('boiStatus defaults to domestic and reports for foreign', () => {
  assert.equal(boiStatus().status, 'exempt');
  const foreign = boiStatus({ entityType: 'foreign' });
  assert.equal(foreign.status, 'reporting-required');
  assert.equal(foreign.reportingRequired, true);
});

// ---------------------------------------------------------------------------
// renderForm — HTML escaping + banner
// ---------------------------------------------------------------------------

test('renderForm escapes a malicious entity name and shows the banner', () => {
  const d = generateDraft('tx-llc-formation', {
    entityName: '<script>alert(1)</script>',
    registeredAgent: 'Agent Co',
    registeredAgentAddress: '5 Main St, Austin TX',
    management: 'member-managed',
    organizer: 'Org Person',
  });
  assert.equal(d.ok, true);
  const html = renderForm(d);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script present');
  assert.ok(html.includes('not a law firm') || /not a law firm/i.test(html), 'banner shown');
});

test('renderForm escapes the banner content and renders an intake field list too', () => {
  const wiz = intake('dba');
  const html = renderForm(wiz);
  assert.match(html, /class="filing-form"/);
  assert.match(html, /Assumed name/i); // a DBA field label
  assert.match(html, /not a law firm/i);
});

test('renderForm tolerates junk input without throwing', () => {
  assert.doesNotThrow(() => renderForm(null));
  assert.doesNotThrow(() => renderForm({}));
  const html = renderForm({});
  assert.match(html, /not a law firm/i); // banner always present
});

// ---------------------------------------------------------------------------
// Banner contract
// ---------------------------------------------------------------------------

test('BANNER asserts not-a-law-firm, not-legal-advice, no funds, consult counsel', () => {
  assert.match(BANNER, /not a law firm/i);
  assert.match(BANNER, /not legal advice/i);
  assert.match(BANNER, /hold your funds/i);
  assert.match(BANNER, /attorney|counsel/i);
});
