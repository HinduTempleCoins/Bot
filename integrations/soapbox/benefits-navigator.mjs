// benefits-navigator.mjs — the HONEST benefits navigator for SoapBox (task #214, v3 doc §3): "Lesko but
// better." It surfaces real official programs (grants, loans, cost-shares, tax credits, services) and
// TELLS THE TRUTH about what each one actually is.
//
// THE CORE INSIGHT, encoded as code: "free money" claims are almost always wrong. Every program carries
// an honest `mechanism` classification — and the navigator NEVER calls a loan "free money":
//   • grant                    — money you do NOT repay (and even then: eligibility-gated, competitive)
//   • loan                     — you REPAY it, with interest (every SBA 7(a)/microloan is a LOAN)
//   • cost-share-reimbursement — you PAY FIRST and get reimbursed AFTER you build + pass inspection
//                                (e.g. USDA NRCS EQIP high tunnel)
//   • tax-credit               — reduces taxes owed; no cash up front
//   • insurance                — risk coverage you pay premiums for
//   • service                  — free expert help, not money (SCORE, SBDC)
//
// DESIGN (matches fed-opportunities.mjs / macro.mjs house style):
//   • ESM .mjs, injectable fetch via __setFetch, defensive dynamic import of the live readers (a break
//     in fed-opportunities.mjs cannot break this module — it soft-fails to the curated seed).
//   • Every list reader soft-fails to [] on any error.
//   • Secrets by env NAME only (delegated entirely to fed-opportunities.mjs — none read here).
//   • Every interpolated value is HTML-escaped before it reaches markup.
//   • Every render carries the not-advice line.
//
//   import { PROGRAMS, classifyMechanism, searchPrograms, truthCheck, renderPage } from './benefits-navigator.mjs'
//   node integrations/soapbox/benefits-navigator.mjs "high tunnel"

const str = (s) => String(s == null ? '' : s).trim();

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The standing disclaimer — present on every rendered page, by construction.
export const NOT_ADVICE =
  'Not financial or legal advice. Program terms change — verify eligibility, amounts, and deadlines ' +
  'with the administering agency before acting.';

// Human-readable badge for each mechanism. The badge is the truth-telling surface: it states, in plain
// English, what the money actually IS — so a "free money" headline cannot mislead a reader.
export const MECHANISM_BADGE = {
  grant: 'GRANT — money you do not repay (eligibility-gated)',
  loan: 'LOAN — you repay this, with interest',
  'cost-share-reimbursement': 'COST-SHARE — you pay first, reimbursed after inspection',
  'tax-credit': 'TAX CREDIT — reduces taxes owed, no cash up front',
  insurance: 'INSURANCE — risk coverage you pay premiums for',
  service: 'FREE SERVICE — expert help, not money',
  varies: 'VARIES — check the specific program; not necessarily a cash grant',
};
export const MECHANISMS = Object.keys(MECHANISM_BADGE);

// ── PROGRAMS — curated seed of REAL programs with honest classification ───────────────────────────────
// Each row tells the truth in plain English. honest_summary is what the program REALLY is, not how a
// "free government money" book would sell it.
export const PROGRAMS = [
  {
    name: 'USDA NRCS EQIP — Seasonal High Tunnel',
    agency: 'USDA Natural Resources Conservation Service',
    mechanism: 'cost-share-reimbursement',
    honest_summary:
      'This is NOT free money. EQIP is a cost-share you get REIMBURSED for AFTER you build the high ' +
      'tunnel and it passes inspection — you pay out of pocket first. You must sign the contract BEFORE ' +
      'you build; building first disqualifies the expense. Payment runs roughly $5.90–$12.21 per square ' +
      'foot up to about a 2,160 sq ft cap. Historically-underserved applicants may receive about a 50% ' +
      'advance up front; everyone else is reimbursed only on completion.',
    eligibility_notes:
      'Must control the land, have an operating farm number with USDA FSA, and sign the EQIP contract ' +
      'BEFORE construction begins. Reimbursement only after the practice is installed and inspected.',
    source_url: 'https://www.nrcs.usda.gov/programs-initiatives/eqip-environmental-quality-incentives',
  },
  {
    name: 'SBA 7(a) Loan',
    agency: 'U.S. Small Business Administration',
    mechanism: 'loan',
    honest_summary:
      'A LOAN — you repay it with interest. The SBA does not hand you cash; it guarantees a bank loan so ' +
      'a lender is more willing to approve you. There is no "SBA grant" version of this. Calling it free ' +
      'money is simply wrong.',
    eligibility_notes:
      'For-profit US small business, owner-invested equity, demonstrated repayment ability; applied for ' +
      'through an SBA-approved lender, not the SBA directly.',
    source_url: 'https://www.sba.gov/funding-programs/loans/7a-loans',
  },
  {
    name: 'SBA Microloan',
    agency: 'U.S. Small Business Administration',
    mechanism: 'loan',
    honest_summary:
      'A LOAN of up to $50,000 (average around $13,000), made through nonprofit intermediary lenders — ' +
      'you repay it with interest. Useful for startups and small needs, but it is borrowed money, not a ' +
      'grant.',
    eligibility_notes:
      'Apply through an SBA-approved nonprofit microlender; terms and credit requirements set by the ' +
      'intermediary. Repaid over up to ~6 years.',
    source_url: 'https://www.sba.gov/funding-programs/loans/microloans',
  },
  {
    name: 'Grants.gov — Federal Grant Opportunities',
    agency: 'Grants.gov (cross-agency)',
    mechanism: 'grant',
    honest_summary:
      'Real grants you do not repay — but they are competitive and tightly eligibility-gated, and most ' +
      'are for organizations, governments, and researchers rather than individuals. "Free money for ' +
      'anyone" is a myth; read each opportunity\'s eligibility section.',
    eligibility_notes:
      'Eligibility varies per opportunity (nonprofits, states/locals, tribes, institutions, sometimes ' +
      'individuals). Requires SAM.gov registration for most awards.',
    source_url: 'https://www.grants.gov/',
  },
  {
    name: 'Benefits.gov — Benefit Programs Finder',
    agency: 'Benefits.gov (cross-agency)',
    mechanism: 'varies',
    honest_summary:
      'A finder across hundreds of federal/state benefit programs. What you get VARIES wildly — some are ' +
      'assistance payments, many are services, loans, or tax credits. The tool tells you what you may ' +
      'qualify for; it does not mean cash will be mailed to you.',
    eligibility_notes:
      'Each linked program has its own income, household, status, and residency rules. The finder is a ' +
      'screening tool, not an application or an entitlement.',
    source_url: 'https://www.benefits.gov/',
  },
  {
    name: 'SCORE Mentoring',
    agency: 'SCORE (SBA resource partner)',
    mechanism: 'service',
    honest_summary:
      'Free expert business mentoring — NOT money. Experienced volunteers help you plan, but no funds ' +
      'change hands. Valuable, free, and honest about being a service rather than a grant.',
    eligibility_notes: 'Open to any US small business owner or aspiring entrepreneur. Free of charge.',
    source_url: 'https://www.score.org/',
  },
  {
    name: 'Small Business Development Centers (SBDC)',
    agency: 'SBA / host universities',
    mechanism: 'service',
    honest_summary:
      'Free, one-on-one business advising and low-cost training through local centers — a SERVICE, not ' +
      'funding. They can help you prepare a loan or grant application, but they do not give you money.',
    eligibility_notes: 'Open to US small businesses; advising is free, some workshops have a small fee.',
    source_url: 'https://www.sba.gov/local-assistance/resource-partners/small-business-development-centers-sbdc',
  },
];

// ── classifyMechanism(text) — infer the mechanism from program text (pure, keyword heuristics) ────────
// Order matters: the most truth-protecting / most specific signals win. A program that says "free" but
// also "repay" is a LOAN — the loan signal must beat the free-money framing.
export function classifyMechanism(text) {
  const t = str(text).toLowerCase();
  if (!t) return 'varies';
  // Cost-share / reimbursement — you pay first.
  if (/reimburs|cost[\s-]?share|pay first|after (?:inspection|completion|installation)|advance payment/.test(t)) {
    return 'cost-share-reimbursement';
  }
  // Grant escape hatch: "no repayment" / "does not have to be repaid" / "forgivable" is a GRANT signal,
  // not a loan — check it before the loan keywords so "no repayment required" isn't read as a loan.
  if (/no repayment|do(?:es)? not (?:have to )?(?:be )?repaid|not repaid|forgivable/.test(t)) return 'grant';
  // Loan — you repay, with interest. Beats any "free money" wording in the same text.
  if (/\bloan\b|repay|repaid|interest rate|amortiz|principal|borrow|lender|guaranteed by the sba/.test(t)) {
    return 'loan';
  }
  // Tax credit.
  if (/tax credit|tax[\s-]?deduction|reduces? (?:your )?tax|offset.*tax/.test(t)) return 'tax-credit';
  // Insurance.
  if (/\binsurance\b|premium|indemnity|risk coverage|crop insurance/.test(t)) return 'insurance';
  // Free service / mentoring / advising — help, not money.
  if (/mentor|advising|counsel|technical assistance|free (?:help|service|training|consult)/.test(t)) {
    return 'service';
  }
  // Grant — money you don't repay. Require an award-ish signal, not just the word "free".
  if (/\bgrant\b|award(?:ed)?|stipend|no repayment|do(?:es)? not (?:have to )?(?:be )?repay|forgivable/.test(t)) {
    return 'grant';
  }
  return 'varies';
}

// ── truthCheck(program) — flag "free money" framing that mismatches the real mechanism ────────────────
// Scans the program's text for free-money framing. If the text sells "free money / grant / no strings"
// but the classified mechanism is a loan, cost-share, tax-credit, or insurance, we flag it as dishonest.
// Free-money framing — but NOT when negated ("NOT free money", "this is not free money"). The negative
// lookbehind keeps an honest program that says "this is NOT free money" from being flagged as dishonest.
const FREE_MONEY_RE = /(?<!\bnot\s)(?<!\bnot\b)(?:free money|free (?:government )?(?:cash|grant|funds?)|no strings|never (?:pay|repay) (?:it )?back)/i;
const NON_GIFT = new Set(['loan', 'cost-share-reimbursement', 'tax-credit', 'insurance']);

export function truthCheck(program = {}) {
  const text = [program.name, program.honest_summary, program.eligibility_notes, program.raw, program.description]
    .map(str).join(' \n ');
  const mechanism = str(program.mechanism) || classifyMechanism(text);
  const claimsFree = FREE_MONEY_RE.test(text);
  if (claimsFree && NON_GIFT.has(mechanism)) {
    return {
      honest: false,
      mechanism,
      why: `Text uses "free money" framing, but this is a ${mechanism.replace(/-/g, ' ')} — ` +
        (mechanism === 'loan' ? 'you repay it, with interest.'
          : mechanism === 'cost-share-reimbursement' ? 'you pay first and are reimbursed only after inspection.'
          : mechanism === 'tax-credit' ? 'it reduces taxes owed; it is not cash handed to you.'
          : 'it is risk coverage with premiums, not a gift.'),
    };
  }
  if (claimsFree && mechanism === 'service') {
    return { honest: false, mechanism, why: 'Text uses "free money" framing, but this is a free service — no money is given.' };
  }
  return { honest: true, mechanism, why: '' };
}

// Normalize a live fed-opportunities row (or any loose object) into a navigator program with an honest
// mechanism + summary. Live grant rows are mechanism 'grant' but still carry the eligibility caveat.
function normalizeLive(row = {}) {
  const name = str(row.title || row.name) || 'Untitled opportunity';
  const text = [name, row.agency, row.honest_summary, row.description, row.raw, row.type].map(str).join(' \n ');
  const mechanism = str(row.mechanism) || classifyMechanism(text) || (row.type === 'grant' ? 'grant' : 'varies');
  return {
    name,
    agency: str(row.agency) || null,
    mechanism,
    honest_summary: str(row.honest_summary) ||
      (mechanism === 'grant'
        ? 'A federal grant opportunity — money you do not repay, but competitive and eligibility-gated. Read the full eligibility section before applying.'
        : `Live opportunity classified as ${mechanism.replace(/-/g, ' ')}. ${MECHANISM_BADGE[mechanism] || ''}`),
    eligibility_notes: str(row.eligibility_notes) || 'See the source listing for eligibility and deadlines.',
    source_url: str(row.url || row.source_url) || null,
    live: true,
  };
}

// Defensive dynamic import of the live federal readers. If the module is missing or throws on import,
// we return null and the navigator falls back to the curated seed alone — a break there cannot break us.
async function loadLiveReaders() {
  try {
    const mod = await import('./fed-opportunities.mjs');
    // Mirror our injected fetch into the live reader so tests stay offline + deterministic.
    if (typeof mod.__setFetch === 'function') { try { mod.__setFetch(_fetch); } catch { /* ignore */ } }
    return mod;
  } catch { return null; }
}

// ── searchPrograms(query, { fetchers }) — merge curated PROGRAMS + live feeds, all honestly classified ─
// `fetchers` (optional) lets a caller inject live feed functions for tests/offline:
//   { grants: async (q) => [...rows] }  — each returned row is normalized + classified.
// When no fetchers are injected, we defensively import fed-opportunities.mjs and use its `grants`. Every
// branch soft-fails: a thrown/absent feed yields the curated results alone, never an error.
export async function searchPrograms(query = '', { fetchers = null } = {}) {
  const q = str(query).toLowerCase();
  const matches = (p) => {
    if (!q) return true;
    return [p.name, p.agency, p.honest_summary, p.eligibility_notes, p.mechanism]
      .some((f) => str(f).toLowerCase().includes(q));
  };
  const curated = PROGRAMS.filter(matches).map((p) => ({ ...p, source: 'curated' }));

  // Resolve the live grant feed: injected fetcher first, else the defensively-imported reader.
  let liveRows = [];
  try {
    let grantsFn = fetchers && typeof fetchers.grants === 'function' ? fetchers.grants : null;
    if (!grantsFn) {
      const mod = await loadLiveReaders();
      if (mod && typeof mod.grants === 'function') grantsFn = (kw) => mod.grants({ keyword: kw });
    }
    if (grantsFn) {
      const raw = await grantsFn(query);
      if (Array.isArray(raw)) liveRows = raw.map((r) => ({ ...normalizeLive(r), source: 'live' }));
    }
  } catch { liveRows = []; }

  return [...curated, ...liveRows];
}

// ── renderPage(results) — escaped HTML with the mechanism BADGE on every program + the not-advice line ─
export function renderPage(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const cards = rows.map((p) => {
    const mech = str(p.mechanism) || 'varies';
    const badge = MECHANISM_BADGE[mech] || MECHANISM_BADGE.varies;
    const tc = truthCheck(p);
    const warn = tc.honest ? '' :
      `\n      <p class="truth-warning"><strong>Heads up:</strong> ${esc(tc.why)}</p>`;
    const link = p.source_url
      ? `<a href="${esc(p.source_url)}">${esc(p.name)}</a>` : esc(p.name);
    return `    <article class="program mechanism-${esc(mech)}">
      <h3>${link}</h3>
      <p class="agency">${esc(p.agency)}</p>
      <p class="mechanism-badge"><strong>${esc(badge)}</strong></p>
      <p class="honest-summary">${esc(p.honest_summary)}</p>
      <p class="eligibility"><em>Eligibility:</em> ${esc(p.eligibility_notes)}</p>${warn}
    </article>`;
  }).join('\n');
  const list = cards || '    <p class="empty">No programs found.</p>';
  return `<section class="benefits-navigator">
  <h2>Benefits Navigator — Honest Funding Finder</h2>
  <p class="intro">Real official programs, labeled by what they actually are. A loan is never "free money."</p>
${list}
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/benefits-navigator.mjs <query> ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('benefits-navigator.mjs')) {
  const query = process.argv.slice(2).join(' ');
  const results = await searchPrograms(query);
  console.log(`\n# Benefits Navigator${query ? `: ${query}` : ''} (${results.length})\n`);
  for (const p of results) {
    console.log(`  - ${p.name} [${p.mechanism}]`);
    console.log(`      ${MECHANISM_BADGE[p.mechanism] || MECHANISM_BADGE.varies}`);
    const tc = truthCheck(p);
    if (!tc.honest) console.log(`      ⚠ ${tc.why}`);
  }
  console.log(`\n${NOT_ADVICE}`);
}
