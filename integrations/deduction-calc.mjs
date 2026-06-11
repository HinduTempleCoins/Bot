// deduction-calc.mjs — US itemized-deduction & taxable-income calculator (backlog f033e6e3e6).
//
// PURE off-chain arithmetic for the "Calculate deductions" / "Format for tax software"
// items (435/436). NOTHING here is advice. No network, no secrets, no model, no W-2 photo
// OCR (that needs a model and lives elsewhere). This file only answers, given numbers the
// caller already has: what is the standard deduction, what does the itemized total come to
// after the SALT cap and the medical-expense AGI floor, which deduction is larger, what is
// the resulting taxable income, and how do those numbers flatten into rows a tax program /
// spreadsheet can import as CSV.
//
//   import {
//     standardDeduction, sumItemized, chooseDeduction, taxableIncome, toTaxSoftwareRows,
//   } from './deduction-calc.mjs'
//   node integrations/deduction-calc.mjs single 2024
//
// IMPORTANT — NOT TAX ADVICE. These are mechanical calculations on numbers you supply, from
// a small embedded table of published figures. They are not tax, legal, or financial advice,
// may be out of date, and do not cover every situation (extra standard deduction for age 65+
// or blindness, AMT, phase-outs, state rules, etc.). Verify against IRS instructions or a
// qualified preparer before filing.
//
// Soft-fail everywhere: a bad call returns { ok:false, error } and never throws. All money
// inputs must be finite and non-negative.

// --- HTML escape (strict; for any future render path / CLI safety) ----------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- validation helper ------------------------------------------------------

function isNonNegNum(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

// Round to whole cents to avoid binary-float dust in the outputs.
function cents(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// --- filing statuses --------------------------------------------------------

// Canonical four statuses. Aliases are normalized so callers can pass common spellings.
export const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];

const STATUS_ALIASES = {
  single: 'single',
  s: 'single',
  mfj: 'mfj',
  married: 'mfj',
  married_joint: 'mfj',
  married_filing_jointly: 'mfj',
  joint: 'mfj',
  mfs: 'mfs',
  married_separate: 'mfs',
  married_filing_separately: 'mfs',
  separate: 'mfs',
  hoh: 'hoh',
  head: 'hoh',
  head_of_household: 'hoh',
};

function normalizeStatus(filingStatus) {
  if (typeof filingStatus !== 'string') return null;
  const key = filingStatus.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[key] ?? null;
}

// --- embedded standard-deduction table -------------------------------------
//
// Published IRS standard-deduction amounts (base amounts; does NOT include the extra
// standard deduction for taxpayers 65+ or blind). Recent years only. If a requested year
// is not in the table we soft-fall-back to the latest known year and flag it.
export const STANDARD_DEDUCTION_TABLE = {
  2021: { single: 12550, mfj: 25100, mfs: 12550, hoh: 18800 },
  2022: { single: 12950, mfj: 25900, mfs: 12950, hoh: 19400 },
  2023: { single: 13850, mfj: 27700, mfs: 13850, hoh: 20800 },
  2024: { single: 14600, mfj: 29200, mfs: 14600, hoh: 21900 },
  2025: { single: 15000, mfj: 30000, mfs: 15000, hoh: 22500 },
};

export const LATEST_KNOWN_YEAR = Math.max(
  ...Object.keys(STANDARD_DEDUCTION_TABLE).map(Number),
);

// SALT (state-and-local-tax) deduction cap, IRC §164(b)(6). $10,000 for most statuses,
// $5,000 for married-filing-separately.
export const SALT_CAP = 10000;
export const SALT_CAP_MFS = 5000;

// Medical/dental expenses are deductible only to the extent they exceed this fraction of AGI.
export const MEDICAL_AGI_FLOOR_RATE = 0.075; // 7.5%

// --- standardDeduction ------------------------------------------------------
//
// standardDeduction({ filingStatus, year }) -> { ok, amount, filingStatus, year, fellBack }
// `fellBack` is true when the requested year was not in the table and the latest known
// year's figure was used instead.
export function standardDeduction({ filingStatus, year } = {}) {
  const status = normalizeStatus(filingStatus);
  if (!status) {
    return { ok: false, error: `filingStatus must be one of ${FILING_STATUSES.join('/')} (got ${esc(String(filingStatus))})` };
  }
  if (year !== undefined && !(Number.isInteger(year) && year >= 1900 && year <= 2200)) {
    return { ok: false, error: 'year must be an integer like 2024' };
  }

  const requested = year ?? LATEST_KNOWN_YEAR;
  let used = requested;
  let fellBack = false;
  if (!STANDARD_DEDUCTION_TABLE[requested]) {
    used = LATEST_KNOWN_YEAR;
    fellBack = true;
  }

  return {
    ok: true,
    amount: STANDARD_DEDUCTION_TABLE[used][status],
    filingStatus: status,
    year: used,
    requestedYear: requested,
    fellBack,
  };
}

// --- sumItemized ------------------------------------------------------------
//
// sumItemized({ mortgageInterest, saltCapped, charity, medicalOverAgi, agi, filingStatus })
//   - mortgageInterest : deductible home-mortgage interest (caller pre-limits the loan balance)
//   - saltCapped       : the RAW state+local taxes paid (we apply the $10k / $5k cap here)
//   - charity          : charitable contributions
//   - medicalOverAgi    : RAW total medical/dental expenses (we apply the 7.5%-AGI floor here)
//   - agi              : adjusted gross income (needed for the medical floor)
//   - filingStatus     : optional; only changes the SALT cap (mfs -> $5k)
//
// Returns the components AFTER limits plus the itemized total. Soft-fail/never-throws.
export function sumItemized({
  mortgageInterest = 0,
  saltCapped = 0,
  charity = 0,
  medicalOverAgi = 0,
  agi = 0,
  filingStatus,
} = {}) {
  const fields = { mortgageInterest, saltCapped, charity, medicalOverAgi, agi };
  for (const [k, v] of Object.entries(fields)) {
    if (!isNonNegNum(v)) return { ok: false, error: `${k} must be a non-negative finite number` };
  }

  // SALT cap (default $10k; $5k for MFS).
  const status = filingStatus === undefined ? null : normalizeStatus(filingStatus);
  if (filingStatus !== undefined && !status) {
    return { ok: false, error: `filingStatus must be one of ${FILING_STATUSES.join('/')} (got ${esc(String(filingStatus))})` };
  }
  const cap = status === 'mfs' ? SALT_CAP_MFS : SALT_CAP;
  const saltAllowed = Math.min(saltCapped, cap);
  const saltDisallowed = cents(saltCapped - saltAllowed);

  // Medical floor: only the portion above 7.5% of AGI counts.
  const medicalFloor = cents(agi * MEDICAL_AGI_FLOOR_RATE);
  const medicalAllowed = cents(Math.max(0, medicalOverAgi - medicalFloor));

  const components = {
    mortgageInterest: cents(mortgageInterest),
    salt: cents(saltAllowed),
    charity: cents(charity),
    medical: medicalAllowed,
  };
  const total = cents(
    components.mortgageInterest + components.salt + components.charity + components.medical,
  );

  return {
    ok: true,
    total,
    components,
    saltCap: cap,
    saltDisallowed,
    medicalFloor,
    medicalDisallowed: cents(Math.min(medicalOverAgi, medicalFloor)),
  };
}

// --- chooseDeduction --------------------------------------------------------
//
// chooseDeduction(std, itemized) -> { ok, amount, method, savingsOverOther }
// Accepts either bare numbers or the result objects from standardDeduction / sumItemized
// (it reads `.amount` / `.total`). Picks the larger; ties favor the standard deduction
// (simpler, no Schedule A). Never throws.
export function chooseDeduction(std, itemized) {
  const stdAmount = typeof std === 'number' ? std : std && typeof std.amount === 'number' ? std.amount : NaN;
  const itemAmount = typeof itemized === 'number'
    ? itemized
    : itemized && typeof itemized.total === 'number' ? itemized.total : NaN;

  if (!isNonNegNum(stdAmount)) return { ok: false, error: 'standard deduction must be a non-negative number (or a standardDeduction() result)' };
  if (!isNonNegNum(itemAmount)) return { ok: false, error: 'itemized deduction must be a non-negative number (or a sumItemized() result)' };

  const itemizeWins = itemAmount > stdAmount; // tie -> standard
  return {
    ok: true,
    amount: itemizeWins ? cents(itemAmount) : cents(stdAmount),
    method: itemizeWins ? 'itemized' : 'standard',
    standard: cents(stdAmount),
    itemized: cents(itemAmount),
    savingsOverOther: cents(Math.abs(itemAmount - stdAmount)),
  };
}

// --- taxableIncome ----------------------------------------------------------
//
// taxableIncome({ agi, deduction }) -> { ok, taxableIncome, agi, deduction }
// deduction may be a number or a chooseDeduction()/standardDeduction() result (reads .amount).
// Floors at 0 (taxable income is never negative). Never throws.
export function taxableIncome({ agi, deduction } = {}) {
  const ded = typeof deduction === 'number'
    ? deduction
    : deduction && typeof deduction.amount === 'number' ? deduction.amount : NaN;

  if (!isNonNegNum(agi)) return { ok: false, error: 'agi must be a non-negative finite number' };
  if (!isNonNegNum(ded)) return { ok: false, error: 'deduction must be a non-negative number (or a deduction result)' };

  const ti = cents(Math.max(0, agi - ded));
  return {
    ok: true,
    taxableIncome: ti,
    agi: cents(agi),
    deduction: cents(ded),
    deductionExceedsAgi: ded > agi,
  };
}

// --- toTaxSoftwareRows ------------------------------------------------------
//
// toTaxSoftwareRows(result) -> { ok, rows:[{label,value}], csv }
// Flattens a combined calculation into plain {label, value} rows for spreadsheet / tax-software
// import. `result` is a loose bag of the pieces the caller has computed; every field is optional
// and only present pieces are emitted. `csv` is a ready-to-write two-column CSV string.
export function toTaxSoftwareRows(result = {}) {
  if (result == null || typeof result !== 'object') {
    return { ok: false, error: 'result must be an object' };
  }
  const {
    filingStatus,
    year,
    agi,
    standard,
    itemized,
    itemizedComponents,
    method,
    deduction,
    taxableIncome: ti,
  } = result;

  const rows = [];
  const push = (label, value) => {
    if (value === undefined || value === null) return;
    rows.push({ label, value: typeof value === 'number' ? cents(value) : value });
  };

  push('Filing status', filingStatus);
  push('Tax year', year);
  push('Adjusted gross income (AGI)', agi);
  push('Standard deduction', standard);
  if (itemizedComponents && typeof itemizedComponents === 'object') {
    push('Itemized: home mortgage interest', itemizedComponents.mortgageInterest);
    push('Itemized: state & local taxes (capped)', itemizedComponents.salt);
    push('Itemized: charitable contributions', itemizedComponents.charity);
    push('Itemized: medical (over AGI floor)', itemizedComponents.medical);
  }
  push('Itemized deduction total', itemized);
  push('Deduction method used', method);
  push('Deduction applied', deduction);
  push('Taxable income', ti);

  // CSV: header + escaped two-column rows. Quote-wrap and double internal quotes.
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = ['label,value', ...rows.map((r) => `${q(r.label)},${q(r.value)}`)].join('\n');

  return { ok: true, rows, csv };
}

// --- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const filingStatus = process.argv[2] ?? 'single';
  const year = Number(process.argv[3] ?? LATEST_KNOWN_YEAR);
  const agi = Number(process.argv[4] ?? 90000);

  const std = standardDeduction({ filingStatus, year });
  const item = sumItemized({
    mortgageInterest: 9000,
    saltCapped: 14000, // over the $10k cap on purpose
    charity: 3000,
    medicalOverAgi: 8000,
    agi,
    filingStatus,
  });
  const choice = chooseDeduction(std, item);
  const ti = taxableIncome({ agi, deduction: choice });
  const out = toTaxSoftwareRows({
    filingStatus: std.ok ? std.filingStatus : filingStatus,
    year: std.ok ? std.year : year,
    agi,
    standard: std.ok ? std.amount : undefined,
    itemized: item.ok ? item.total : undefined,
    itemizedComponents: item.ok ? item.components : undefined,
    method: choice.ok ? choice.method : undefined,
    deduction: choice.ok ? choice.amount : undefined,
    taxableIncome: ti.ok ? ti.taxableIncome : undefined,
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ std, item, choice, ti, out }, null, 2));
}
