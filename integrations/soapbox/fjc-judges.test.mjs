// fjc-judges.test.mjs — offline tests for the FJC Biographical Directory reader.
// Network stubbed via __setFetch with canned CSV/JSON; keyless. Run: node --test integrations/soapbox/fjc-judges.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  judges, findByNid, findByName, parseCsv, normalizeRows, bioUrl,
  renderPage, dataNote, SOURCE_URL, __setFetch,
} from './fjc-judges.mjs';

// Long-form FJC export: one row per (judge × appointment). Ginsburg has two Article III seats sharing nid.
const CSV = [
  'nid,"Last Name","First Name","Middle Name","Suffix","Birth Year","Death Year","Court Type (1)","Court Name (1)","Appointment Title (1)","Appointing President (1)","Party of Appointing President (1)","Commission Date (1)","Termination Date (1)","Termination Reason (1)"',
  '100,"Ginsburg","Ruth","Bader","","1933","2020","U.S. Court of Appeals","U.S. Court of Appeals for the District of Columbia Circuit","Circuit Judge","Jimmy Carter","Democratic","1980-06-30","1993-08-09","Elevation"',
  '100,"Ginsburg","Ruth","Bader","","1933","2020","Supreme Court","Supreme Court of the United States","Associate Justice","William J. Clinton","Democratic","1993-08-10","2020-09-18","Death"',
  '200,"Marshall","Thurgood","","","1908","1993","Supreme Court","Supreme Court of the United States","Associate Justice","Lyndon B. Johnson","Democratic","1967-10-02","1991-10-01","Retirement"',
].join('\n');

const CSV_QUOTED_COMMA = [
  'nid,"Last Name","First Name","Court Name (1)"',
  '300,"Hand","Learned","U.S. District Court, Southern District of New York"',
].join('\n');

function textFetch(text, { ok = true } = {}) { return async () => ({ ok, text: async () => text }); }
function throwingFetch() { return async () => { throw new Error('down'); }; }

test('parseCsv handles headers, quoted fields, and embedded commas', () => {
  const rows = parseCsv(CSV_QUOTED_COMMA);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Last Name'], 'Hand');
  assert.equal(rows[0]['Court Name (1)'], 'U.S. District Court, Southern District of New York');
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('   '), []);
});

test('normalizeRows coalesces multiple appointments under one nid', () => {
  const cards = normalizeRows(parseCsv(CSV));
  assert.equal(cards.length, 2); // Ginsburg + Marshall
  const rbg = cards.find((c) => c.nid === '100');
  assert.equal(rbg.name, 'Ruth Bader Ginsburg');
  assert.equal(rbg.birthYear, '1933');
  assert.equal(rbg.appointments.length, 2);
  assert.equal(rbg.appointments[0].court, 'U.S. Court of Appeals for the District of Columbia Circuit');
  assert.equal(rbg.appointments[1].title, 'Associate Justice');
  assert.equal(rbg.appointments[1].president, 'William J. Clinton');
  assert.match(rbg.source, /Federal Judicial Center/);
});

test('bioUrl + SOURCE_URL point at fjc.gov', () => {
  assert.equal(bioUrl('100'), 'https://www.fjc.gov/node/100');
  assert.equal(bioUrl(''), '');
  assert.match(SOURCE_URL, /^https:\/\/www\.fjc\.gov\//);
  assert.match(SOURCE_URL, /judges\.csv$/);
});

test('judges() parses the live CSV export into coalesced cards', async () => {
  __setFetch(textFetch(CSV));
  const all = await judges();
  __setFetch(null);
  assert.equal(all.length, 2);
  assert.ok(all.every((c) => c.url.startsWith('https://www.fjc.gov/node/')));
});

test('judges() also accepts a JSON export', async () => {
  const jsonExport = JSON.stringify([
    { nid: '400', 'Last Name': 'Sotomayor', 'First Name': 'Sonia', 'Birth Year': '1954',
      'Court Name (1)': 'Supreme Court of the United States', 'Appointment Title (1)': 'Associate Justice',
      'Appointing President (1)': 'Barack Obama' },
  ]);
  __setFetch(textFetch(jsonExport));
  const all = await judges();
  __setFetch(null);
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'Sonia Sotomayor');
  assert.equal(all[0].appointments[0].court, 'Supreme Court of the United States');
});

test('judges() soft-fails to [] on network error and unparseable JSON', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await judges(), []);
  __setFetch(textFetch('[ this is not json'));
  assert.deepEqual(await judges(), []);
  __setFetch(null);
});

test('findByNid / findByName look judges up', async () => {
  __setFetch(textFetch(CSV));
  const rbg = await findByNid('100');
  const byName = await findByName('marsh');
  const miss = await findByNid('999');
  __setFetch(null);
  assert.equal(rbg.name, 'Ruth Bader Ginsburg');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, 'Thurgood Marshall');
  assert.equal(miss, null);
  assert.deepEqual(await findByName(''), []);
});

test('renderPage renders service record as facts and escapes injection', () => {
  const html = renderPage([{
    nid: '1', name: '<i>X</i>', birthYear: '1900', deathYear: '',
    appointments: [{ court: 'Supreme Court', title: 'Justice', president: 'Someone', commissionDate: '1990-01-01', terminationDate: '', terminationReason: '' }],
  }]);
  assert.ok(html.includes('Article III federal judges'));
  assert.ok(!html.includes('<i>X</i>'));
  assert.ok(html.includes('&lt;i&gt;'));
  assert.ok(html.includes('Supreme Court'));
  assert.ok(renderPage([]).includes('No judges found'));
});

test('dataNote names the FJC, public domain, and corrections path', () => {
  const n = dataNote();
  assert.match(n, /Federal Judicial Center/);
  assert.match(n, /public domain/);
  assert.match(n, /fjc\.gov/);
});
