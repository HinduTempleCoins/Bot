// deduction-calc.test.mjs — offline tests for the US itemized-deduction & taxable-income
// calculator. Pure arithmetic; no network, no model, never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  standardDeduction,
  sumItemized,
  chooseDeduction,
  taxableIncome,
  toTaxSoftwareRows,
  STANDARD_DEDUCTION_TABLE,
  LATEST_KNOWN_YEAR,
  SALT_CAP,
  SALT_CAP_MFS,
  esc,
} from './deduction-calc.mjs';

// --- standardDeduction: table lookup + alias normalization ------------------

test('standardDeduction: known year/status from table', () => {
  const r = standardDeduction({ filingStatus: 'single', year: 2024 });
  assert.equal(r.ok, true);
  assert.equal(r.amount, 14600);
  assert.equal(r.filingStatus, 'single');
  assert.equal(r.fellBack, false);
});

test('standardDeduction: normalizes aliases (married -> mfj)', () => {
  const r = standardDeduction({ filingStatus: 'Married Filing Jointly', year: 2023 });
  assert.equal(r.ok, true);
  assert.equal(r.filingStatus, 'mfj');
  assert.equal(r.amount, STANDARD_DEDUCTION_TABLE[2023].mfj);
});

test('standardDeduction: unknown year soft-falls-back to latest with flag', () => {
  const r = standardDeduction({ filingStatus: 'hoh', year: 2099 });
  assert.equal(r.ok, true);
  assert.equal(r.fellBack, true);
  assert.equal(r.year, LATEST_KNOWN_YEAR);
  assert.equal(r.requestedYear, 2099);
  assert.equal(r.amount, STANDARD_DEDUCTION_TABLE[LATEST_KNOWN_YEAR].hoh);
});

test('standardDeduction: missing year uses latest, no fallback flag', () => {
  const r = standardDeduction({ filingStatus: 'single' });
  assert.equal(r.ok, true);
  assert.equal(r.fellBack, false);
  assert.equal(r.year, LATEST_KNOWN_YEAR);
});

test('standardDeduction: bad status soft-fails', () => {
  const r = standardDeduction({ filingStatus: 'widow', year: 2024 });
  assert.equal(r.ok, false);
  assert.match(r.error, /filingStatus/);
});

test('standardDeduction: bad year soft-fails', () => {
  const r = standardDeduction({ filingStatus: 'single', year: 'twenty' });
  assert.equal(r.ok, false);
});

// --- sumItemized: SALT cap --------------------------------------------------

test('sumItemized: SALT capped at $10k for single', () => {
  const r = sumItemized({ saltCapped: 18000, agi: 100000 });
  assert.equal(r.ok, true);
  assert.equal(r.components.salt, SALT_CAP); // 10000
  assert.equal(r.saltDisallowed, 8000);
  assert.equal(r.saltCap, SALT_CAP);
});

test('sumItemized: SALT capped at $5k for MFS', () => {
  const r = sumItemized({ saltCapped: 9000, agi: 50000, filingStatus: 'mfs' });
  assert.equal(r.ok, true);
  assert.equal(r.components.salt, SALT_CAP_MFS); // 5000
  assert.equal(r.saltDisallowed, 4000);
  assert.equal(r.saltCap, SALT_CAP_MFS);
});

test('sumItemized: SALT under cap is unchanged', () => {
  const r = sumItemized({ saltCapped: 4000, agi: 80000 });
  assert.equal(r.components.salt, 4000);
  assert.equal(r.saltDisallowed, 0);
});

// --- sumItemized: medical 7.5% AGI floor ------------------------------------

test('sumItemized: medical floor at 7.5% of AGI', () => {
  // AGI 100k -> floor 7500. Medical 10000 -> 2500 deductible.
  const r = sumItemized({ medicalOverAgi: 10000, agi: 100000 });
  assert.equal(r.ok, true);
  assert.equal(r.medicalFloor, 7500);
  assert.equal(r.components.medical, 2500);
  assert.equal(r.medicalDisallowed, 7500);
});

test('sumItemized: medical below floor -> nothing deductible', () => {
  const r = sumItemized({ medicalOverAgi: 5000, agi: 100000 });
  assert.equal(r.components.medical, 0);
  assert.equal(r.medicalDisallowed, 5000); // all of it, since below the 7500 floor
});

test('sumItemized: full total combines all components after limits', () => {
  const r = sumItemized({
    mortgageInterest: 9000,
    saltCapped: 14000, // -> 10000
    charity: 3000,
    medicalOverAgi: 10000, // AGI 100k floor 7500 -> 2500
    agi: 100000,
  });
  assert.equal(r.total, 9000 + 10000 + 3000 + 2500); // 24500
});

test('sumItemized: negative input soft-fails', () => {
  const r = sumItemized({ charity: -1, agi: 50000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /charity/);
});

test('sumItemized: bad filingStatus soft-fails', () => {
  const r = sumItemized({ saltCapped: 1000, agi: 50000, filingStatus: 'nope' });
  assert.equal(r.ok, false);
});

// --- chooseDeduction: std vs itemized ---------------------------------------

test('chooseDeduction: itemized larger wins', () => {
  const c = chooseDeduction(14600, 24500);
  assert.equal(c.ok, true);
  assert.equal(c.method, 'itemized');
  assert.equal(c.amount, 24500);
  assert.equal(c.savingsOverOther, 24500 - 14600);
});

test('chooseDeduction: standard larger wins', () => {
  const c = chooseDeduction(14600, 9000);
  assert.equal(c.method, 'standard');
  assert.equal(c.amount, 14600);
});

test('chooseDeduction: tie favors standard', () => {
  const c = chooseDeduction(14600, 14600);
  assert.equal(c.method, 'standard');
});

test('chooseDeduction: accepts result objects', () => {
  const std = standardDeduction({ filingStatus: 'single', year: 2024 }); // 14600
  const item = sumItemized({ mortgageInterest: 20000, agi: 100000 }); // total 20000
  const c = chooseDeduction(std, item);
  assert.equal(c.ok, true);
  assert.equal(c.method, 'itemized');
  assert.equal(c.amount, 20000);
});

test('chooseDeduction: bad input soft-fails', () => {
  const c = chooseDeduction(-1, 5);
  assert.equal(c.ok, false);
});

// --- taxableIncome ----------------------------------------------------------

test('taxableIncome: agi minus deduction', () => {
  const t = taxableIncome({ agi: 100000, deduction: 24500 });
  assert.equal(t.ok, true);
  assert.equal(t.taxableIncome, 75500);
  assert.equal(t.deductionExceedsAgi, false);
});

test('taxableIncome: floors at zero when deduction exceeds AGI', () => {
  const t = taxableIncome({ agi: 10000, deduction: 14600 });
  assert.equal(t.taxableIncome, 0);
  assert.equal(t.deductionExceedsAgi, true);
});

test('taxableIncome: accepts chooseDeduction result', () => {
  const c = chooseDeduction(14600, 24500);
  const t = taxableIncome({ agi: 100000, deduction: c });
  assert.equal(t.taxableIncome, 100000 - 24500);
});

test('taxableIncome: negative agi soft-fails', () => {
  const t = taxableIncome({ agi: -5, deduction: 1000 });
  assert.equal(t.ok, false);
});

// --- toTaxSoftwareRows ------------------------------------------------------

test('toTaxSoftwareRows: flattens to label/value rows + CSV', () => {
  const std = standardDeduction({ filingStatus: 'single', year: 2024 });
  const item = sumItemized({
    mortgageInterest: 9000, saltCapped: 14000, charity: 3000, medicalOverAgi: 10000, agi: 100000,
  });
  const choice = chooseDeduction(std, item);
  const ti = taxableIncome({ agi: 100000, deduction: choice });
  const out = toTaxSoftwareRows({
    filingStatus: std.filingStatus,
    year: std.year,
    agi: 100000,
    standard: std.amount,
    itemized: item.total,
    itemizedComponents: item.components,
    method: choice.method,
    deduction: choice.amount,
    taxableIncome: ti.taxableIncome,
  });
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.rows));
  const labels = out.rows.map((r) => r.label);
  assert.ok(labels.includes('Taxable income'));
  assert.ok(labels.includes('Itemized: state & local taxes (capped)'));
  // CSV has a header and one line per row.
  const lines = out.csv.split('\n');
  assert.equal(lines[0], 'label,value');
  assert.equal(lines.length, out.rows.length + 1);
});

test('toTaxSoftwareRows: omits absent fields', () => {
  const out = toTaxSoftwareRows({ agi: 50000, taxableIncome: 50000 });
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 2);
});

test('toTaxSoftwareRows: CSV quotes and escapes labels/values', () => {
  const out = toTaxSoftwareRows({ filingStatus: 'sin"gle', agi: 1000 });
  assert.match(out.csv, /"sin""gle"/);
});

test('toTaxSoftwareRows: non-object soft-fails', () => {
  const out = toTaxSoftwareRows(42);
  assert.equal(out.ok, false);
});

// --- esc --------------------------------------------------------------------

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
