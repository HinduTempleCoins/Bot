// business-credit-bot.mjs — Business Credit Building Bot (task #212, v3 doc §1).
//
// A KNOWLEDGE BASE + WORKFLOW STATE MACHINE that walks a user through building real
// business credit, step by deterministic step. It touches NO funds, signs nothing,
// holds no keys. It is a teacher and a progress-tracker, nothing more.
//
// Shape mirrors tutorial/stages.json (an ordered, prerequisite-gated FSM with a
// time-gated step) and the soapbox/*.mjs module style (pure functions, injectable
// I/O, escaped HTML render, CLI guarded behind an import.meta check, soft-fail).
//
// THE PATHWAY (the real, boring, works-in-the-real-world sequence):
//   1. Active state-registered legal entity (LLC/corp) — the credit lives on the entity.
//   2. EIN from the IRS (free) — the entity's tax ID, the "SSN" of the business.
//   3. Business bank account in the entity's exact legal name.
//   4. A real street address + a listed business phone (411 / directory-listed).
//   5. A free D-U-N-S number from Dun & Bradstreet — opens the D&B file.
//   6. Net-30 vendor tradelines that actually REPORT (Uline, Quill, Grainger).
//   7. 3–6 months of ON-TIME payment history accruing — THIS STEP IS TIME-GATED.
//   8. A business credit card — once the file and history support it.
//
// HARD GUARDRAIL (load-bearing — the scam-space discipline is the moat):
//   This module builds REAL tradelines and REAL payment history ONLY. It REFUSES,
//   with an explanation, anything matching CPN / synthetic-identity / "boost fast" /
//   buying tradelines / shelf-corp credit schemes. Those are fraud, not credit.
//
// NOT FINANCIAL OR LEGAL ADVICE — every user-facing output carries that line.

export const NOT_ADVICE =
  'This is general business-credit education, not financial, legal, or tax advice. ' +
  'Confirm specifics with a licensed professional and the official sources directly.';

// ---------------------------------------------------------------------------
// KB — bureaus, vendors that report, and the separate-from-personal principle.
// Everything cited to an official source BY NAME (no live calls; this is reference).
// ---------------------------------------------------------------------------

export const KB = {
  bureaus: [
    {
      id: 'dnb',
      name: 'Dun & Bradstreet',
      score: 'PAYDEX',
      tracks:
        'Trade payment history keyed to the D-U-N-S number. PAYDEX runs 1–100; ' +
        '80 means paid-on-terms, above 80 means paid early. Dollar-weighted by tradeline size.',
      source: 'Dun & Bradstreet (dnb.com)',
    },
    {
      id: 'experian-business',
      name: 'Experian Business',
      score: 'Intelliscore Plus / Business Credit Score (1–100)',
      tracks:
        'Tradelines, public records, collections, and business demographics. ' +
        'Builds a file automatically once vendors report — no application needed.',
      source: 'Experian Business (experian.com/business)',
    },
    {
      id: 'equifax-business',
      name: 'Equifax Business',
      score: 'Business Credit Risk Score + Business Failure Score',
      tracks:
        'Credit utilization, trade payment trends, public records, and company size/age. ' +
        'Reports a payment index alongside risk scores.',
      source: 'Equifax Business (equifax.com/business)',
    },
  ],

  // Vendors widely documented to extend net-30 terms to new businesses AND report to a
  // business bureau — the realistic on-ramp tradelines. Names only; terms change, so the
  // user must confirm current reporting/terms with each vendor directly.
  reportingVendors: [
    { name: 'Uline', terms: 'net-30', goods: 'shipping & packaging supplies', source: 'uline.com' },
    { name: 'Quill', terms: 'net-30', goods: 'office supplies', source: 'quill.com' },
    { name: 'Grainger', terms: 'net-30', goods: 'industrial / MRO supplies', source: 'grainger.com' },
  ],

  separateFromPersonal: {
    principle:
      'Business credit is built on the ENTITY (its EIN, bank account, and D-U-N-S file), ' +
      'kept separate from your personal credit and SSN. Avoid a personal guarantee wherever ' +
      'the vendor or card allows it, so the business stands on its own and personal credit is ' +
      'insulated. Early on some accounts still require a personal guarantee — that is normal; ' +
      'the goal is to reduce reliance on it over time, not to hide or misrepresent anything.',
    source: 'U.S. Small Business Administration (sba.gov) + the three business bureaus',
  },
};

// ---------------------------------------------------------------------------
// STEPS — the 8-step FSM. `prereqs` are stepIds that must be done first;
// `gate` (optional) is a timing constraint enforced against the clock.
// ---------------------------------------------------------------------------

export const MIN_HISTORY_MONTHS = 3; // step 7 lower bound; 6 months is stronger.
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

export const STEPS = [
  {
    id: 1,
    key: 'entity',
    label: 'Form an active state-registered entity',
    prereqs: [],
    what: 'Register an LLC or corporation with your state and keep it in good standing.',
    why: 'Business credit attaches to a legal entity, not to you personally. No entity, no file to build.',
    how: 'File through your state\'s Secretary of State (or business-filing) office and keep the entity active.',
    source: 'Your state Secretary of State + IRS (irs.gov)',
  },
  {
    id: 2,
    key: 'ein',
    label: 'Get an EIN from the IRS',
    prereqs: [1],
    what: 'Obtain a free Employer Identification Number for the entity.',
    why: 'The EIN is the business\'s tax ID — the "SSN of the business" that bureaus and banks key to.',
    how: 'Apply free directly at irs.gov. Never pay a third party for an EIN.',
    source: 'IRS (irs.gov)',
  },
  {
    id: 3,
    key: 'bank',
    label: 'Open a business bank account',
    prereqs: [1, 2],
    what: 'Open a dedicated bank account in the entity\'s exact legal name.',
    why: 'Separates business and personal money — required for clean books and for many tradelines/cards.',
    how: 'Bring your formation documents and EIN letter to a bank or credit union.',
    source: 'Your chosen bank / credit union',
  },
  {
    id: 4,
    key: 'address_phone',
    label: 'Establish a street address + listed business phone',
    prereqs: [1],
    what: 'Have a real business street address (not a PO box) and a phone number listed in directory assistance (411).',
    why: 'Bureaus and underwriters verify a business exists at a consistent, listed location and number.',
    how: 'Use a commercial address you control and list the business number with a phone provider / 411 directory.',
    source: 'The three business bureaus (verification criteria)',
  },
  {
    id: 5,
    key: 'duns',
    label: 'Get a free D-U-N-S number',
    prereqs: [1, 2],
    what: 'Request a free D-U-N-S number from Dun & Bradstreet to open your D&B file.',
    why: 'The D-U-N-S number is the key your PAYDEX and trade history are filed under at D&B.',
    how: 'Request it free directly at dnb.com. Do not pay for expedited "credit builder" upsells to get the number itself.',
    source: 'Dun & Bradstreet (dnb.com)',
  },
  {
    id: 6,
    key: 'tradelines',
    label: 'Open net-30 vendor tradelines that report',
    prereqs: [2, 3, 5],
    what: 'Open accounts with vendors that extend net-30 terms AND report to a business bureau (e.g. Uline, Quill, Grainger).',
    why: 'Reported on-time payments are the raw material of a business credit file. Tradelines that don\'t report do nothing.',
    how: 'Open accounts in the entity\'s name/EIN, buy things the business actually needs, and pay on time. Confirm each vendor reports.',
    source: 'KB.reportingVendors (confirm current reporting with each vendor)',
  },
  {
    id: 7,
    key: 'history',
    label: 'Build 3–6 months of on-time payment history',
    prereqs: [6],
    what: 'Pay every tradeline on time (or early) for at least 3–6 months so a track record accrues.',
    why: 'A credit profile is time plus consistency. There is no honest shortcut — this is the step scammers sell around.',
    how: 'Keep paying on or before the due date. Watch your PAYDEX / business scores begin to populate.',
    gate: {
      kind: 'elapsed_months_since_prereq',
      sincePrereqStepId: 6,
      minMonths: MIN_HISTORY_MONTHS,
    },
    source: 'Dun & Bradstreet PAYDEX + Experian/Equifax business files',
  },
  {
    id: 8,
    key: 'card',
    label: 'Apply for a business credit card',
    prereqs: [7],
    what: 'Apply for a business credit card now that the file and payment history support it.',
    why: 'A card is a revolving tradeline that deepens the profile — earned by the history, not bought ahead of it.',
    how: 'Apply with the entity\'s details; prefer cards that report to business bureaus and minimize personal guarantee where possible.',
    source: 'Issuing bank + the three business bureaus',
  },
];

const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
const FIRST_STEP = STEPS[0];

// ---------------------------------------------------------------------------
// Progress — plain serializable state. `completed` maps stepId -> ISO timestamp.
// ---------------------------------------------------------------------------

/** A fresh, empty progress object. Pure. */
export function newProgress() {
  return { version: 1, completed: {} };
}

function isDone(progress, stepId) {
  return Boolean(progress?.completed?.[stepId]);
}

/** The next step the user should work on (first incomplete step), or null if all done. */
export function currentStep(progress) {
  for (const step of STEPS) {
    if (!isDone(progress, step.id)) return step;
  }
  return null; // everything complete
}

function prereqsMet(progress, step) {
  return step.prereqs.every((pid) => isDone(progress, pid));
}

// Evaluate a timing gate. Returns { ok } or { ok:false, reason, waitMonths }.
function checkGate(progress, step, now) {
  if (!step.gate) return { ok: true };
  const g = step.gate;
  if (g.kind === 'elapsed_months_since_prereq') {
    const since = progress?.completed?.[g.sincePrereqStepId];
    if (!since) {
      return { ok: false, reason: `Complete step ${g.sincePrereqStepId} first to start the clock.` };
    }
    const elapsedMs = now - new Date(since).getTime();
    const elapsedMonths = elapsedMs / MS_PER_MONTH;
    if (elapsedMonths < g.minMonths) {
      const remaining = g.minMonths - elapsedMonths;
      return {
        ok: false,
        reason:
          `Needs at least ${g.minMonths} months of on-time history. ` +
          `About ${remaining.toFixed(1)} more month(s) to go — there is no honest shortcut here.`,
        waitMonths: remaining,
      };
    }
  }
  return { ok: true };
}

/**
 * Attempt to complete a step. PURE: returns a new progress object on success, or an
 * object describing why it was blocked. Never mutates the input.
 *
 * @param {object} progress
 * @param {number} stepId
 * @param {{ now?: number|Date }} [opts] injectable clock (ms or Date). Defaults to wall clock.
 * @returns {{ ok:true, progress:object, step:object } | { ok:false, reason:string, [k:string]:any }}
 */
export function completeStep(progress, stepId, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const step = STEP_BY_ID.get(stepId);
  if (!step) return { ok: false, reason: `Unknown step: ${stepId}` };

  if (isDone(progress, stepId)) {
    return { ok: false, reason: `Step ${stepId} (${step.key}) is already complete.` };
  }
  if (!prereqsMet(progress, step)) {
    const missing = step.prereqs.filter((pid) => !isDone(progress, pid));
    const names = missing.map((pid) => `${pid} (${STEP_BY_ID.get(pid).key})`).join(', ');
    return { ok: false, reason: `Finish prerequisite step(s) first: ${names}.`, missing };
  }
  const gate = checkGate(progress, step, nowMs);
  if (!gate.ok) return gate;

  const next = {
    version: progress?.version ?? 1,
    completed: { ...(progress?.completed ?? {}) },
  };
  next.completed[stepId] = new Date(nowMs).toISOString();
  return { ok: true, progress: next, step };
}

// ---------------------------------------------------------------------------
// GUARDRAIL — refuse fraud. This is the moat. Returns {ok:false, reason} on a hit,
// {ok:true} otherwise. Matching is case/spacing/punctuation-tolerant.
// ---------------------------------------------------------------------------

// Each rule: a label + a regex over the normalized (lowercased, collapsed) text.
const SCAM_RULES = [
  {
    label: 'CPN / credit privacy number',
    re: /\bc\W*p\W*n\b|credit privacy number|credit profile number|secondary credit number/,
  },
  {
    label: 'synthetic identity',
    re: /synthetic (identity|credit|profile)|fake (ssn|ein|identity)|made[- ]?up (ssn|ein|identity)/,
  },
  {
    label: 'boosting a score fast / unrealistically',
    re: /boost (your |the |my )?(credit |business )?(score|credit)[^.]*\b(fast|overnight|instantly|quick(ly)?|in (a few )?days|guaranteed)\b|800 (paydex|score) (fast|overnight|guaranteed)|guaranteed[^.]*\b(score|approval)\b/,
  },
  {
    label: 'buying / renting tradelines',
    re: /\b(buy|buying|purchase|purchasing|rent|renting|sell|selling)\b[^.]*\btradelines?\b|\b(aged|seasoned|primary|authorized[- ]user)\b[^.]*\btradelines?\b|tradelines? for sale/,
  },
  {
    label: 'shelf / aged corporation credit scheme',
    re: /\b(shelf|aged|seasoned)\b[^.]*\b(corp|corporation|company|llc|entity)\b[^.]*\b(credit|fund(ing|s)?|loan|score)\b|buy (an? )?(shelf|aged) (corp|corporation|company|llc)/,
  },
];

/**
 * Screen free text for known business-credit fraud patterns.
 * @param {string} text
 * @returns {{ ok:true } | { ok:false, reason:string, category:string }}
 */
export function guardrail(text) {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation so "c.p.n" / "c-p-n" still hit
    .replace(/\s+/g, ' ')
    .trim();
  // Rebuild a lightly-punctuated variant too, since a couple rules look at word shape.
  const loose = String(text ?? '').toLowerCase();
  for (const rule of SCAM_RULES) {
    if (rule.re.test(norm) || rule.re.test(loose)) {
      return {
        ok: false,
        category: rule.label,
        reason:
          `Refused: this looks like "${rule.label}", which is credit fraud, not credit building. ` +
          'This bot builds REAL tradelines and REAL on-time payment history only — the legitimate ' +
          'path is the slow one. ' +
          NOT_ADVICE,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// advise — plain-English "what to do next", always carrying the not-advice line.
// ---------------------------------------------------------------------------

/**
 * Plain-English guidance for where the user is in the pathway.
 * @param {object} progress
 * @param {{ now?: number|Date }} [opts]
 * @returns {{ done:boolean, stepId:number|null, headline:string, detail:string, text:string, notAdvice:string }}
 */
export function advise(progress, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const step = currentStep(progress);

  if (!step) {
    const headline = 'You have completed the business-credit pathway.';
    const detail =
      'Your entity has an EIN, a bank account, a D-U-N-S file, reporting tradelines with on-time ' +
      'history, and a business credit card. Keep paying on time and your PAYDEX and business scores ' +
      'will keep improving. Add reporting tradelines slowly as the business actually needs them.';
    return {
      done: true,
      stepId: null,
      headline,
      detail,
      text: `${headline} ${detail}\n\n${NOT_ADVICE}`,
      notAdvice: NOT_ADVICE,
    };
  }

  // If this step is gated and not yet ready, say so plainly.
  const gate = checkGate(progress, step, nowMs);
  let headline = `Next: Step ${step.id} — ${step.label}.`;
  let detail = `${step.what} Why it matters: ${step.why} How: ${step.how}`;

  if (!gate.ok && step.gate) {
    headline = `Step ${step.id} — ${step.label}: not yet. ${gate.reason}`;
    detail =
      `Keep doing the previous step well in the meantime. ${step.why} ` +
      'The waiting period is the point — a real payment record cannot be rushed.';
  } else if (!prereqsMet(progress, step)) {
    const missing = step.prereqs.filter((pid) => !isDone(progress, pid));
    const names = missing.map((pid) => `Step ${pid} (${STEP_BY_ID.get(pid).label})`).join(', ');
    headline = `Before Step ${step.id} (${step.label}), finish: ${names}.`;
  }

  return {
    done: false,
    stepId: step.id,
    headline,
    detail,
    text: `${headline}\n\n${detail}\n\n${NOT_ADVICE}`,
    notAdvice: NOT_ADVICE,
  };
}

// ---------------------------------------------------------------------------
// renderChecklist — escaped HTML view of the pathway + the user's progress.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/**
 * Render the 8-step checklist as escaped HTML, marking each step done / current / locked.
 * @param {object} progress
 * @param {{ now?: number|Date }} [opts]
 * @returns {string} HTML
 */
export function renderChecklist(progress, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const cur = currentStep(progress);
  const rows = STEPS.map((step) => {
    const done = isDone(progress, step.id);
    const isCurrent = cur && cur.id === step.id;
    let status = 'locked';
    let mark = '☐'; // ballot box
    if (done) {
      status = 'done';
      mark = '☑'; // ballot box with check
    } else if (isCurrent) {
      const gate = checkGate(progress, step, nowMs);
      status = gate.ok ? 'current' : 'waiting';
      mark = gate.ok ? '▶' : '⏳'; // play / hourglass
    }
    const when = done ? ` <span class="bc-when">(done ${esc(progress.completed[step.id])})</span>` : '';
    return (
      `<li class="bc-step bc-${esc(status)}">` +
      `<span class="bc-mark">${mark}</span> ` +
      `<strong>Step ${esc(step.id)}: ${esc(step.label)}</strong>${when}` +
      `<div class="bc-what">${esc(step.what)}</div>` +
      `</li>`
    );
  }).join('');

  return (
    `<div class="business-credit-checklist">` +
    `<h3>Business Credit Pathway</h3>` +
    `<ol class="bc-steps">${rows}</ol>` +
    `<p class="bc-disclaimer">${esc(NOT_ADVICE)}</p>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// CLI (guarded) — quick human-readable dump of the pathway + a guardrail demo.
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('business-credit-bot.mjs')) {
  console.log('Business Credit Pathway (task #212)\n');
  for (const s of STEPS) {
    const gate = s.gate ? `  [time-gated: ${s.gate.minMonths}mo since step ${s.gate.sincePrereqStepId}]` : '';
    console.log(`  ${s.id}. ${s.label}${gate}`);
    console.log(`     prereqs: ${s.prereqs.length ? s.prereqs.join(', ') : 'none'}`);
  }
  console.log('\nBureaus:');
  for (const b of KB.bureaus) console.log(`  ${b.name} — ${b.score}`);
  console.log('\nReporting net-30 vendors:');
  for (const v of KB.reportingVendors) console.log(`  ${v.name} (${v.terms}) — ${v.source}`);
  console.log('\nGuardrail demo:');
  for (const t of ['how do net-30 vendors work?', 'sell me aged tradelines', 'get a CPN']) {
    const g = guardrail(t);
    console.log(`  "${t}" -> ${g.ok ? 'OK' : 'REFUSED (' + g.category + ')'}`);
  }
  console.log(`\n${NOT_ADVICE}`);
}
