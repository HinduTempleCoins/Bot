// filing-app.mjs — Business & Civic Filing App core (task #213, v3 doc §2).
//
// A DOCUMENT-AUTOMATION SERVICE: it holds a knowledge base of TX + federal filing
// templates, runs an intake wizard, fills a draft from the user's answers, validates
// required fields, and tracks recurring compliance deadlines. It is NOT a law firm.
//
// Shape mirrors the sibling business-credit-bot.mjs (task #212): pure/deterministic
// functions, injectable clock, escaped-HTML render, soft-fail returns (never throws on
// bad input), CLI guarded behind an import.meta check, no secrets, no network.
//
// HARD GUARDRAILS (load-bearing — these are the legal posture, encoded as code):
//   1. DOCUMENT SERVICE, NOT A LAW FIRM. Every user-facing output carries the
//      not-legal-advice / not-a-law-firm / consult-counsel banner.
//   2. NEVER HOLDS CLIENT FUNDS. The user pays the state directly. Filing fees are
//      tagged `paid-to-state-by-user`; there is NO payment-collection path anywhere
//      in this module. generateDraft asserts no payment step is emitted.
//   3. GENERATE-FOR-USER-TO-FILE. v1 produces a draft for the user to file themselves.
//      No auto-efile, no portal submission, no aggregator API call.
//
// NOT LEGAL ADVICE — see BANNER below.

export const BANNER =
  'This is an automated document-preparation service, not a law firm, and this is not ' +
  'legal advice. We do not represent you, hold your funds, or file on your behalf. You ' +
  'file the completed document yourself and pay any fee directly to the government agency. ' +
  'Confirm all requirements with the official source and consult a licensed attorney for ' +
  'your situation.';

// Fee marker — load-bearing. Every filing fee is paid by the user to the state/agency
// directly. This module never collects, escrows, or routes money. This exact string is
// the assertion the tests check for the "no client funds" guarantee.
export const FEE_PAID_BY_USER = 'paid-to-state-by-user';

// ---------------------------------------------------------------------------
// FILINGS — TX + federal filing templates. Each:
//   { id, name, jurisdiction, fee, form, fields:[{key,label,required,help?}], cadence?,
//     agency, source, template }
// `cadence` (optional) marks recurring filings for the compliance calendar.
// `template` is a plain string with {{key}} placeholders filled by generateDraft.
// NO field anywhere requests payment information — only the substance of the filing.
// ---------------------------------------------------------------------------

const f = (key, label, required = true, help) => ({ key, label, required, help });

export const FILINGS = [
  // ---- Federal ----------------------------------------------------------
  {
    id: 'ein',
    name: 'EIN Application (Employer Identification Number)',
    jurisdiction: 'federal',
    agency: 'IRS',
    form: 'SS-4',
    fee: FEE_PAID_BY_USER, // EIN is free at irs.gov; never pay a third party.
    source: 'IRS — Apply for an EIN (irs.gov)',
    fields: [
      f('legalName', 'Exact legal name of the entity'),
      f('tradeName', 'Trade name / DBA (if different)', false),
      f('entityType', 'Entity type (LLC, corporation, nonprofit, sole proprietor)'),
      f('responsibleParty', 'Name of the responsible party'),
      f('responsiblePartyTin', 'Responsible party SSN/ITIN/EIN'),
      f('mailingAddress', 'Mailing address'),
      f('reasonForApplying', 'Reason for applying (started new business, etc.)'),
    ],
    template:
      'IRS Form SS-4 — Application for Employer Identification Number\n' +
      'Legal name: {{legalName}}\n' +
      'Trade name / DBA: {{tradeName}}\n' +
      'Entity type: {{entityType}}\n' +
      'Responsible party: {{responsibleParty}} (TIN: {{responsiblePartyTin}})\n' +
      'Mailing address: {{mailingAddress}}\n' +
      'Reason for applying: {{reasonForApplying}}\n' +
      'File free directly at irs.gov. Do not pay any third party for an EIN.',
  },
  {
    id: '1023-ez',
    name: 'Form 1023-EZ — Streamlined 501(c)(3) Application',
    jurisdiction: 'federal',
    agency: 'IRS',
    form: '1023-EZ',
    fee: FEE_PAID_BY_USER, // user pays the IRS user fee directly via pay.gov.
    source: 'IRS — Form 1023-EZ (irs.gov) + Pay.gov',
    fields: [
      f('legalName', 'Exact legal name of the organization'),
      f('ein', 'EIN of the organization'),
      f('mailingAddress', 'Mailing address'),
      f('ntee', 'NTEE code (activity classification)'),
      f('purpose', 'Exempt purpose (charitable/religious/educational/etc.)'),
      f('eligibilityAttested', 'Eligibility Worksheet completed and you qualify (yes/no)'),
    ],
    template:
      'IRS Form 1023-EZ — Streamlined Application for Recognition of Exemption\n' +
      'Organization: {{legalName}} (EIN: {{ein}})\n' +
      'Mailing address: {{mailingAddress}}\n' +
      'NTEE code: {{ntee}}\n' +
      'Exempt purpose: {{purpose}}\n' +
      'Eligibility Worksheet completed: {{eligibilityAttested}}\n' +
      'Submit on Pay.gov; pay the IRS user fee there yourself.',
  },
  {
    id: '1023',
    name: 'Form 1023 — 501(c)(3) Application (long form)',
    jurisdiction: 'federal',
    agency: 'IRS',
    form: '1023',
    fee: FEE_PAID_BY_USER,
    source: 'IRS — Form 1023 (irs.gov)',
    fields: [
      f('legalName', 'Exact legal name of the organization'),
      f('ein', 'EIN of the organization'),
      f('mailingAddress', 'Mailing address'),
      f('purpose', 'Detailed description of activities and exempt purpose'),
      f('financials', 'Financial data / projected budget summary'),
    ],
    template:
      'IRS Form 1023 — Application for Recognition of Exemption\n' +
      'Organization: {{legalName}} (EIN: {{ein}})\n' +
      'Mailing address: {{mailingAddress}}\n' +
      'Activities / exempt purpose: {{purpose}}\n' +
      'Financial data: {{financials}}\n' +
      'Submit on Pay.gov; pay the IRS user fee there yourself.',
  },
  {
    id: '990',
    name: 'Form 990 — Return of Organization Exempt From Income Tax',
    jurisdiction: 'federal',
    agency: 'IRS',
    form: '990',
    fee: FEE_PAID_BY_USER, // no fee to file 990; tagged consistently (user files directly).
    cadence: { interval: 'annual', monthsFromFye: 5, day: 15, anchor: 'fiscalYearEnd' },
    source: 'IRS — Form 990 (irs.gov)',
    fields: [
      f('legalName', 'Exact legal name of the organization'),
      f('ein', 'EIN of the organization'),
      f('taxYear', 'Tax year covered'),
      f('fiscalYearEnd', 'Fiscal year end (YYYY-MM-DD)'),
      f('grossReceipts', 'Gross receipts for the year'),
      f('totalAssets', 'Total assets at year end'),
    ],
    template:
      'IRS Form 990 — Return of Organization Exempt From Income Tax\n' +
      'Organization: {{legalName}} (EIN: {{ein}})\n' +
      'Tax year: {{taxYear}} (FYE {{fiscalYearEnd}})\n' +
      'Gross receipts: {{grossReceipts}}\n' +
      'Total assets at year end: {{totalAssets}}\n' +
      'Due the 15th day of the 5th month after fiscal year end. File directly with the IRS.',
  },
  {
    id: '990-ez',
    name: 'Form 990-EZ — Short Form Return',
    jurisdiction: 'federal',
    agency: 'IRS',
    form: '990-EZ',
    fee: FEE_PAID_BY_USER,
    cadence: { interval: 'annual', monthsFromFye: 5, day: 15, anchor: 'fiscalYearEnd' },
    source: 'IRS — Form 990-EZ (irs.gov)',
    fields: [
      f('legalName', 'Exact legal name of the organization'),
      f('ein', 'EIN of the organization'),
      f('taxYear', 'Tax year covered'),
      f('fiscalYearEnd', 'Fiscal year end (YYYY-MM-DD)'),
      f('grossReceipts', 'Gross receipts (must be < $200,000 to use 990-EZ)'),
      f('totalAssets', 'Total assets (must be < $500,000 to use 990-EZ)'),
    ],
    template:
      'IRS Form 990-EZ — Short Form Return of Organization Exempt From Income Tax\n' +
      'Organization: {{legalName}} (EIN: {{ein}})\n' +
      'Tax year: {{taxYear}} (FYE {{fiscalYearEnd}})\n' +
      'Gross receipts: {{grossReceipts}}\n' +
      'Total assets: {{totalAssets}}\n' +
      'Due the 15th day of the 5th month after fiscal year end. File directly with the IRS.',
  },
  // ---- Texas (state) ----------------------------------------------------
  {
    id: 'tx-llc-formation',
    name: 'Texas LLC Formation (Certificate of Formation)',
    jurisdiction: 'TX',
    agency: 'Texas Secretary of State',
    form: 'Form 205',
    fee: FEE_PAID_BY_USER, // state filing fee paid by user to the TX SoS.
    source: 'Texas Secretary of State — Form 205 (sos.state.tx.us)',
    fields: [
      f('entityName', 'Proposed LLC name (must include "LLC" / "Limited Liability Company")'),
      f('registeredAgent', 'Registered agent name'),
      f('registeredAgentAddress', 'Registered agent Texas street address (no PO box)'),
      f('management', 'Management type (member-managed or manager-managed)'),
      f('organizer', 'Organizer name and address'),
      f('purpose', 'Purpose of the LLC', false, 'Defaults to any lawful purpose if omitted'),
    ],
    template:
      'Texas Certificate of Formation — Limited Liability Company (Form 205)\n' +
      'Entity name: {{entityName}}\n' +
      'Registered agent: {{registeredAgent}}\n' +
      'Registered agent address: {{registeredAgentAddress}}\n' +
      'Management: {{management}}\n' +
      'Organizer: {{organizer}}\n' +
      'Purpose: {{purpose}}\n' +
      'File with the Texas Secretary of State; pay the state filing fee directly.',
  },
  {
    id: 'tx-nonprofit-formation',
    name: 'Texas Nonprofit Corporation Formation (Certificate of Formation)',
    jurisdiction: 'TX',
    agency: 'Texas Secretary of State',
    form: 'Form 202',
    fee: FEE_PAID_BY_USER,
    source: 'Texas Secretary of State — Form 202 (sos.state.tx.us)',
    fields: [
      f('entityName', 'Proposed nonprofit corporation name'),
      f('registeredAgent', 'Registered agent name'),
      f('registeredAgentAddress', 'Registered agent Texas street address (no PO box)'),
      f('directors', 'Initial directors (names and addresses)'),
      f('organizer', 'Organizer name and address'),
      f('purpose', 'Nonprofit purpose'),
      f('memberStructure', 'Will the corporation have members? (yes/no)'),
    ],
    template:
      'Texas Certificate of Formation — Nonprofit Corporation (Form 202)\n' +
      'Entity name: {{entityName}}\n' +
      'Registered agent: {{registeredAgent}}\n' +
      'Registered agent address: {{registeredAgentAddress}}\n' +
      'Initial directors: {{directors}}\n' +
      'Organizer: {{organizer}}\n' +
      'Purpose: {{purpose}}\n' +
      'Has members: {{memberStructure}}\n' +
      'File with the Texas Secretary of State; pay the state filing fee directly.',
  },
  {
    id: 'tx-franchise-pir',
    name: 'Texas Franchise Tax & Public Information Report (PIR)',
    jurisdiction: 'TX',
    agency: 'Texas Comptroller of Public Accounts',
    form: 'Franchise Tax Report + Form 05-102 (PIR)',
    fee: FEE_PAID_BY_USER, // any tax due is paid by the user to the Comptroller.
    cadence: { interval: 'annual', month: 5, day: 15 }, // due May 15 annually.
    source: 'Texas Comptroller — Franchise Tax (comptroller.texas.gov)',
    fields: [
      f('entityName', 'Exact legal name of the entity'),
      f('taxpayerNumber', 'Texas taxpayer number'),
      f('reportYear', 'Report year'),
      f('officersDirectors', 'Current officers, directors, and managers'),
      f('registeredAgent', 'Registered agent name and address'),
      f('annualRevenue', 'Total annualized revenue (for No-Tax-Due / EZ determination)'),
    ],
    template:
      'Texas Franchise Tax Report + Public Information Report (Form 05-102)\n' +
      'Entity: {{entityName}} (Taxpayer No: {{taxpayerNumber}})\n' +
      'Report year: {{reportYear}}\n' +
      'Officers / directors / managers: {{officersDirectors}}\n' +
      'Registered agent: {{registeredAgent}}\n' +
      'Total annualized revenue: {{annualRevenue}}\n' +
      'Due May 15 each year. File with the Texas Comptroller; pay any tax due directly.',
  },
  {
    id: 'annual-report',
    name: 'Annual / Periodic Report (state entity)',
    jurisdiction: 'TX',
    agency: 'Texas Secretary of State',
    form: 'Periodic Report (e.g. Form 802 for nonprofits)',
    fee: FEE_PAID_BY_USER,
    cadence: { interval: 'annual', month: 1, day: 1, anchor: 'anniversary' },
    source: 'Texas Secretary of State — Periodic Reports (sos.state.tx.us)',
    fields: [
      f('entityName', 'Exact legal name of the entity'),
      f('fileNumber', 'SoS file number'),
      f('registeredAgent', 'Registered agent name and address'),
      f('directorsOfficers', 'Current directors / officers / managers'),
      f('principalOffice', 'Principal office address'),
    ],
    template:
      'State Annual / Periodic Report\n' +
      'Entity: {{entityName}} (File No: {{fileNumber}})\n' +
      'Registered agent: {{registeredAgent}}\n' +
      'Directors / officers: {{directorsOfficers}}\n' +
      'Principal office: {{principalOffice}}\n' +
      'File with the Secretary of State by your reporting deadline; pay any fee directly.',
  },
  {
    id: 'tx-reinstatement',
    name: 'Texas Entity Reinstatement',
    jurisdiction: 'TX',
    agency: 'Texas Secretary of State',
    form: 'Form 811 (Application for Reinstatement)',
    fee: FEE_PAID_BY_USER,
    source: 'Texas Secretary of State — Form 811 (sos.state.tx.us)',
    fields: [
      f('entityName', 'Exact legal name of the entity'),
      f('fileNumber', 'SoS file number'),
      f('reasonForTermination', 'Reason for forfeiture / termination'),
      f('taxClearance', 'Tax clearance letter obtained from the Comptroller? (yes/no)'),
      f('registeredAgent', 'Current registered agent name and address'),
    ],
    template:
      'Texas Application for Reinstatement (Form 811)\n' +
      'Entity: {{entityName}} (File No: {{fileNumber}})\n' +
      'Reason for termination: {{reasonForTermination}}\n' +
      'Tax clearance obtained: {{taxClearance}}\n' +
      'Registered agent: {{registeredAgent}}\n' +
      'File with the Texas Secretary of State after obtaining tax clearance; pay any fee directly.',
  },
  {
    id: 'dba',
    name: 'Assumed Name (DBA) Certificate',
    jurisdiction: 'TX',
    agency: 'County Clerk / Texas Secretary of State',
    form: 'Form 503 (Assumed Name Certificate)',
    fee: FEE_PAID_BY_USER,
    source: 'Texas Secretary of State — Form 503 + your county clerk',
    fields: [
      f('assumedName', 'Assumed name (DBA) to register'),
      f('legalName', 'Legal name of the owner / entity'),
      f('entityType', 'Owner type (individual, LLC, corporation, nonprofit)'),
      f('principalAddress', 'Principal business address'),
      f('counties', 'County or counties where business is conducted'),
    ],
    template:
      'Assumed Name Certificate (DBA, Form 503)\n' +
      'Assumed name: {{assumedName}}\n' +
      'Owner / entity: {{legalName}} ({{entityType}})\n' +
      'Principal address: {{principalAddress}}\n' +
      'Counties: {{counties}}\n' +
      'File with the Secretary of State and/or county clerk as required; pay any fee directly.',
  },
  {
    id: 'registered-agent',
    name: 'Registered Agent Designation / Change',
    jurisdiction: 'TX',
    agency: 'Texas Secretary of State',
    form: 'Form 401 (Change of Registered Agent/Office)',
    fee: FEE_PAID_BY_USER,
    source: 'Texas Secretary of State — Form 401 (sos.state.tx.us)',
    fields: [
      f('entityName', 'Exact legal name of the entity'),
      f('fileNumber', 'SoS file number'),
      f('newAgentName', 'New registered agent name'),
      f('newAgentAddress', 'New registered agent Texas street address (no PO box)'),
      f('agentConsent', 'Agent has consented to the appointment (yes/no)'),
    ],
    template:
      'Change of Registered Agent / Registered Office (Form 401)\n' +
      'Entity: {{entityName}} (File No: {{fileNumber}})\n' +
      'New registered agent: {{newAgentName}}\n' +
      'New registered office: {{newAgentAddress}}\n' +
      'Agent consent on file: {{agentConsent}}\n' +
      'File with the Texas Secretary of State; pay any fee directly.\n' +
      'Note: a registered agent must have a physical Texas address (presence requirement).',
  },
];

const FILING_BY_ID = new Map(FILINGS.map((x) => [x.id, x]));

/** Look up a filing by id, or null. Pure. */
export function getFiling(filingId) {
  return FILING_BY_ID.get(filingId) ?? null;
}

// ---------------------------------------------------------------------------
// intake — the intake wizard field list for a filing.
// ---------------------------------------------------------------------------

/**
 * Return the wizard for a filing: its identity + the ordered field list to collect.
 * Soft-fail: returns { ok:false } for an unknown filing rather than throwing.
 * @param {string} filingId
 * @returns {{ ok:true, filingId, name, jurisdiction, form, fee, fields:object[], banner } |
 *           { ok:false, reason }}
 */
export function intake(filingId) {
  const filing = getFiling(filingId);
  if (!filing) return { ok: false, reason: `Unknown filing: ${String(filingId)}` };
  return {
    ok: true,
    filingId: filing.id,
    name: filing.name,
    jurisdiction: filing.jurisdiction,
    form: filing.form,
    fee: filing.fee, // always FEE_PAID_BY_USER — surfaced so the UI says "pay the state".
    fields: filing.fields.map((fld) => ({ ...fld })),
    banner: BANNER,
  };
}

// ---------------------------------------------------------------------------
// generateDraft — fill the template from the user's answers.
// Validates required fields; carries the banner; emits NO payment step.
// ---------------------------------------------------------------------------

// Defensive: refuse to emit anything that looks like a payment-collection instruction.
// We never construct such a string; this guard exists so a future template edit can't
// silently introduce one. "pay ... directly to the state/agency" is allowed (that is
// the user paying the government, not us collecting).
const PAYMENT_COLLECTION_RE =
  /\b(pay (us|here|now)|enter (your )?(card|credit card|cvv|payment)|checkout|add to cart|we (will )?charge|billing (info|details)|escrow|hold (your )?funds)\b/i;

/**
 * Produce a filled draft for the user to file themselves.
 * @param {string} filingId
 * @param {Record<string,string>} answers
 * @returns {{ ok:true, filingId, name, jurisdiction, form, fee, fields, body, banner,
 *             paymentStep:false, autoEfile:false } |
 *           { ok:false, reason, missing? }}
 */
export function generateDraft(filingId, answers = {}) {
  const filing = getFiling(filingId);
  if (!filing) return { ok: false, reason: `Unknown filing: ${String(filingId)}` };

  const ans = answers && typeof answers === 'object' ? answers : {};

  // Required-field validation.
  const missing = filing.fields
    .filter((fld) => fld.required)
    .filter((fld) => {
      const v = ans[fld.key];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map((fld) => fld.key);

  if (missing.length) {
    return {
      ok: false,
      reason: `Missing required field(s): ${missing.join(', ')}.`,
      missing,
    };
  }

  // Fill the template. Unsupplied optional fields render as a clear placeholder.
  const filled = filing.template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = ans[key];
    return v === undefined || v === null || String(v).trim() === '' ? '[not provided]' : String(v);
  });

  // Hard assertion: the filled template (the document data the user supplies + our
  // template prose) must never contain a payment-collection instruction. We check the
  // filled template only — the fixed BANNER/instruction boilerplate is authored here and
  // deliberately says "we do NOT hold your funds", which is the correct posture.
  if (PAYMENT_COLLECTION_RE.test(filled)) {
    return {
      ok: false,
      reason:
        'Internal guardrail: a draft must never contain a payment-collection step. ' +
        'This filing\'s template was rejected — report this as a bug.',
    };
  }

  // The body the user files. Banner first, then the filled template, then the
  // explicit user-files-this / fee-paid-to-state note. NEVER a payment step.
  const body =
    `${BANNER}\n\n` +
    `${filled}\n\n` +
    'How to file: download/print this, complete any agency-specific signatures, and submit ' +
    `it yourself to ${filing.agency}. Any fee is ${FEE_PAID_BY_USER} — you pay the agency ` +
    'directly. This service does not collect payment and does not file for you.\n' +
    `Source: ${filing.source}`;

  return {
    ok: true,
    filingId: filing.id,
    name: filing.name,
    jurisdiction: filing.jurisdiction,
    form: filing.form,
    fee: filing.fee,
    fields: { ...ans },
    body,
    banner: BANNER,
    paymentStep: false, // structural guarantee — no payment is ever collected.
    autoEfile: false, // v1 is generate-for-user-to-file only.
  };
}

// ---------------------------------------------------------------------------
// BOI — honest Beneficial Ownership Information reporting status.
// As of the FinCEN interim final rule (March 2025) and into 2026, U.S. domestic
// entities are EXEMPT; only foreign reporting companies file. The rule stays on the
// books, so the compliance layer keeps a monitoring note.
// ---------------------------------------------------------------------------

/**
 * @param {{ entityType?: 'domestic'|'foreign'|string }} [opts]
 * @returns {{ entityType, reportingRequired:boolean, status, note, source, banner }}
 */
export function boiStatus({ entityType = 'domestic' } = {}) {
  const isForeign = String(entityType).toLowerCase() === 'foreign';
  const note = isForeign
    ? 'Foreign reporting companies registered to do business in the U.S. must file a ' +
      'Beneficial Ownership Information (BOI) report with FinCEN under the March 2025 ' +
      'interim final rule. Confirm current deadlines on fincen.gov.'
    : 'U.S. domestic entities are currently EXEMPT from BOI reporting under the FinCEN ' +
      'interim final rule (effective March 2025). The reporting requirement remains on ' +
      'the books, so we monitor it for any change. Confirm on fincen.gov.';
  return {
    entityType: isForeign ? 'foreign' : 'domestic',
    reportingRequired: isForeign,
    status: isForeign ? 'reporting-required' : 'exempt',
    note,
    source: 'FinCEN — Beneficial Ownership Information (fincen.gov)',
    banner: BANNER,
  };
}

// ---------------------------------------------------------------------------
// complianceCalendar — upcoming recurring deadlines for an entity.
// Pure: takes `now` (injectable clock). Returns sorted upcoming deadlines plus the
// BOI monitoring note. The recurring-revenue layer per v3 §2.
// ---------------------------------------------------------------------------

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  const t = Date.parse(String(now));
  return Number.isNaN(t) ? Date.now() : t;
}

// Next occurrence of a fixed month/day deadline at or after `fromMs` (UTC).
function nextFixedDate(fromMs, month /*1-12*/, day) {
  const from = new Date(fromMs);
  let year = from.getUTCFullYear();
  let due = Date.UTC(year, month - 1, day);
  if (due < fromMs) due = Date.UTC(year + 1, month - 1, day);
  return due;
}

// Next occurrence of "N months after fiscal-year-end, on `day`".
function nextFyeDeadline(fromMs, fyeStr, monthsFromFye, day) {
  const fye = Date.parse(fyeStr);
  if (Number.isNaN(fye)) return null;
  const fyeDate = new Date(fye);
  const fyeMonth = fyeDate.getUTCMonth(); // 0-11
  // Deadline month/day repeats annually: (fye month + monthsFromFye), `day`.
  const dueMonth0 = (fyeMonth + monthsFromFye) % 12;
  return nextFixedDate(fromMs, dueMonth0 + 1, day);
}

/**
 * @param {{
 *   entity?: { name?:string, fiscalYearEnd?:string, type?:string, jurisdiction?:string },
 *   filings?: string[],   // filing ids the entity is subject to; defaults to all recurring
 *   now?: number|string|Date,
 * }} opts
 * @returns {{
 *   entity, generatedAt, deadlines: { filing, filingId, dueAt, cadence, note }[],
 *   boi: object, banner
 * }}
 */
export function complianceCalendar({ entity = {}, filings, now = Date.now() } = {}) {
  const nowMs = toMs(now);
  const recurring = FILINGS.filter((x) => x.cadence);
  const wanted =
    Array.isArray(filings) && filings.length
      ? recurring.filter((x) => filings.includes(x.id))
      : recurring;

  const deadlines = [];
  for (const filing of wanted) {
    const c = filing.cadence;
    let dueMs = null;
    let note = '';

    if (c.anchor === 'fiscalYearEnd' && entity.fiscalYearEnd) {
      dueMs = nextFyeDeadline(nowMs, entity.fiscalYearEnd, c.monthsFromFye, c.day);
      note = `Due the ${c.day}th day of month ${c.monthsFromFye} after fiscal year end (${entity.fiscalYearEnd}).`;
    } else if (c.month && c.day) {
      dueMs = nextFixedDate(nowMs, c.month, c.day);
      note = `Due ${c.month}/${c.day} each year.`;
    } else {
      // Fiscal-anchored filing but no FYE supplied — surface it without a hard date.
      note = 'Annual deadline; provide the entity fiscal year end to compute the exact date.';
    }

    deadlines.push({
      filing: filing.name,
      filingId: filing.id,
      dueAt: dueMs ? new Date(dueMs).toISOString() : null,
      cadence: c.interval,
      note,
    });
  }

  // Sort by soonest known due date; undated ones go last.
  deadlines.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  return {
    entity: { ...entity },
    generatedAt: new Date(nowMs).toISOString(),
    deadlines,
    boi: boiStatus({ entityType: entity.type === 'foreign' ? 'foreign' : 'domestic' }),
    banner: BANNER,
  };
}

// ---------------------------------------------------------------------------
// renderForm — escaped HTML preview of a draft (or an intake), always with the banner.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/**
 * Render a generated draft (from generateDraft) as escaped HTML, banner first.
 * Tolerant: if given an intake object (has `fields` array, no `body`), it renders the
 * field list instead. Always escapes; always shows the banner.
 * @param {object} draft
 * @returns {string} HTML
 */
export function renderForm(draft) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const title = esc(d.name || d.filingId || 'Filing');
  const juris = d.jurisdiction ? ` <span class="fa-juris">(${esc(d.jurisdiction)})</span>` : '';
  const banner = `<p class="fa-banner" role="note">${esc(BANNER)}</p>`;

  let inner;
  if (typeof d.body === 'string') {
    // A generated draft: show the filled body verbatim (escaped), preserving newlines.
    inner = `<pre class="fa-draft">${esc(d.body)}</pre>`;
  } else if (Array.isArray(d.fields)) {
    // An intake wizard: show the field list.
    const items = d.fields
      .map(
        (fld) =>
          `<li class="fa-field${fld.required ? ' fa-required' : ''}">` +
          `<strong>${esc(fld.label || fld.key)}</strong>` +
          (fld.required ? ' <span class="fa-req-mark">*</span>' : '') +
          (fld.help ? ` <span class="fa-help">${esc(fld.help)}</span>` : '') +
          `</li>`,
      )
      .join('');
    inner = `<ul class="fa-fields">${items}</ul>`;
  } else {
    inner = '<p class="fa-empty">Nothing to render.</p>';
  }

  const feeLine = d.fee
    ? `<p class="fa-fee">Filing fee: ${esc(d.fee)} — you pay the agency directly; we never collect payment.</p>`
    : '';

  return (
    `<section class="filing-form" aria-label="${title}">` +
    `<h3 class="fa-title">${title}${juris}</h3>` +
    banner +
    feeLine +
    inner +
    `<p class="fa-foot">Generate-for-user-to-file: no auto e-filing, no payment collection.</p>` +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// CLI (guarded) — human-readable dump of the filing catalog + a sample draft.
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('filing-app.mjs')) {
  console.log('Business & Civic Filing App (task #213)\n');
  console.log(`${BANNER}\n`);
  console.log('Filings:');
  for (const x of FILINGS) {
    const cad = x.cadence ? `  [recurring: ${x.cadence.interval}]` : '';
    console.log(`  ${x.id} — ${x.name} [${x.jurisdiction}] (${x.form})${cad}`);
  }
  console.log('\nSample intake (ein):');
  const wiz = intake('ein');
  for (const fld of wiz.fields) console.log(`  ${fld.required ? '*' : ' '} ${fld.label}`);

  console.log('\nSample compliance calendar (FYE 2025-12-31, domestic):');
  const cal = complianceCalendar({
    entity: { name: 'Shaivite Temple', fiscalYearEnd: '2025-12-31', type: 'domestic' },
    now: '2026-06-04',
  });
  for (const dl of cal.deadlines) console.log(`  ${dl.dueAt ?? '(undated)'} — ${dl.filing}`);
  console.log(`  BOI: ${cal.boi.status} — ${cal.boi.note.split('.')[0]}.`);
}
