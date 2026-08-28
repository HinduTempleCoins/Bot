// credit-score.mjs — the content + helpers for the SoapBox Credit-Score Help center.
//
// EDUCATION ONLY. This teaches how credit scores work and points to the FREE, official tools and
// nonprofit help — it is NOT financial advice, NOT "credit repair," and we sell nothing. A recurring
// honest note: anything a paid "credit repair" service does, you can do yourself for free. Pure/offline:
// static, cited data + small helpers; no network, no PII, soft-fail-never-throw.

// FICO score composition (the standard model most lenders use). Weights are FICO's published breakdown.
export const SCORE_FACTORS = Object.freeze([
  { id: 'payment-history', name: 'Payment history', weight: 35, desc: 'Do you pay on time? The single biggest factor. One 30-day-late mark can drop a good score sharply.' },
  { id: 'amounts-owed', name: 'Amounts owed (utilization)', weight: 30, desc: 'How much of your available credit you use. Keep utilization under 30% — under 10% is better. It resets each month, so it is the fastest lever.' },
  { id: 'length-of-history', name: 'Length of credit history', weight: 15, desc: 'The age of your accounts (average and oldest). Time helps — which is why closing an old card can hurt.' },
  { id: 'credit-mix', name: 'Credit mix', weight: 10, desc: 'A mix of types (a card, an installment loan) helps a little. Never take on debt you do not need just for the mix.' },
  { id: 'new-credit', name: 'New credit / inquiries', weight: 10, desc: 'Hard inquiries from applying for credit ding you a little and fade within a year. Rate-shopping for one loan in a short window usually counts as one.' },
]);

// FICO score bands (300–850).
export const SCORE_RANGES = Object.freeze([
  { band: 'poor', min: 300, max: 579, label: 'Poor', note: 'Approvals are hard and terms are worst; secured cards and on-time payments are the way up.' },
  { band: 'fair', min: 580, max: 669, label: 'Fair', note: 'Below the U.S. average; some approvals, higher rates.' },
  { band: 'good', min: 670, max: 739, label: 'Good', note: 'Around/above average; most approvals at fair rates.' },
  { band: 'very-good', min: 740, max: 799, label: 'Very Good', note: 'Better-than-average rates and limits.' },
  { band: 'exceptional', min: 800, max: 850, label: 'Exceptional', note: 'Top tier; the best rates available.' },
]);

/** Which band a score falls in. Soft-fails to null on a non-numeric/out-of-range score. */
export function bandForScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return SCORE_RANGES.find((r) => n >= r.min && n <= r.max) || null;
}

// How to build / improve credit — concrete, free steps.
export const BUILD_STEPS = Object.freeze([
  { id: 'on-time', title: 'Pay every bill on time', desc: 'Autopay at least the minimum. Payment history is 35% — nothing else moves the needle like a clean record.' },
  { id: 'utilization', title: 'Keep utilization low', desc: 'Aim under 30%, ideally under 10%, of each card’s limit. Paying down a balance before the statement date lowers the number that gets reported.' },
  { id: 'keep-old', title: 'Keep old accounts open', desc: 'Length of history helps. Don’t close your oldest card; put a small recurring charge on it so the issuer keeps it active.' },
  { id: 'secured-card', title: 'If you’re starting out, use a secured card', desc: 'You deposit, say, $200 and that becomes your limit; used lightly and paid in full, it builds history with little risk.' },
  { id: 'authorized-user', title: 'Become an authorized user', desc: 'A trusted person adds you to a well-managed old card; their history can help yours. Confirm the issuer reports authorized users.' },
  { id: 'limit-inquiries', title: 'Apply sparingly', desc: 'Each application is a hard inquiry. Space them out; rate-shop one loan within a ~2-week window so it counts once.' },
  { id: 'check-errors', title: 'Check your reports for errors', desc: 'Errors are common and drag scores down. Pull your free reports and dispute anything wrong (see Disputes).' },
]);

// Disputing errors — your FCRA rights + the process. The three nationwide bureaus.
export const BUREAUS = Object.freeze([
  { id: 'equifax', name: 'Equifax', url: 'https://www.equifax.com/personal/credit-report-services/credit-dispute/' },
  { id: 'experian', name: 'Experian', url: 'https://www.experian.com/disputes/main.html' },
  { id: 'transunion', name: 'TransUnion', url: 'https://www.transunion.com/credit-disputes/dispute-your-credit' },
]);
export const DISPUTE_STEPS = Object.freeze([
  { id: 'get-reports', title: 'Get your free reports', desc: 'Pull all three at AnnualCreditReport.com — the only federally authorized free source (now free weekly). Never pay for your own report.' },
  { id: 'find-errors', title: 'Find the errors', desc: 'Wrong balances, accounts that aren’t yours, duplicate or stale negatives, a late mark you actually paid on time.' },
  { id: 'dispute-bureau', title: 'Dispute with the bureau', desc: 'File online or by mail with each bureau showing the error. Under the FCRA they must investigate — usually within 30 days — and correct or remove anything unverifiable.' },
  { id: 'dispute-furnisher', title: 'Dispute with the furnisher too', desc: 'Also notify whoever reported it (the bank/lender). Keep copies of everything and a log of dates.' },
  { id: 'escalate', title: 'Escalate if needed', desc: 'If it isn’t fixed, file a complaint with the CFPB (consumerfinance.gov/complaint). It’s free and effective.' },
]);

// Free, legitimate resources. The recurring warning: paid "credit repair" mostly does what you can do free.
export const RESOURCES = Object.freeze([
  { id: 'annualcreditreport', name: 'AnnualCreditReport.com', url: 'https://www.annualcreditreport.com', note: 'The only federally authorized free credit reports (all three bureaus, weekly).' },
  { id: 'cfpb', name: 'CFPB — Consumer Financial Protection Bureau', url: 'https://www.consumerfinance.gov', note: 'Free guides, sample dispute letters, and a complaint system that works.' },
  { id: 'nfcc', name: 'NFCC — nonprofit credit counseling', url: 'https://www.nfcc.org', note: 'Member agencies offer low/no-cost counseling and debt-management plans.' },
  { id: 'ftc-repair', name: 'FTC — “Credit Repair” facts', url: 'https://consumer.ftc.gov/articles/credit-repair-scams', note: 'Why no one can legally remove accurate negative info, and how repair scams work.' },
]);

// The honest disclaimer used across every page.
export const DISCLAIMER = 'Education only — not financial or legal advice, and we sell nothing. Everything a paid “credit repair” service does, you can do yourself for free with the tools below.';

// CLI demo (guarded)
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('credit-score.mjs')) {
  console.log('factors sum to', SCORE_FACTORS.reduce((s, f) => s + f.weight, 0), '%');
  console.log('720 is', bandForScore(720)?.label, '| 540 is', bandForScore(540)?.label);
  console.log('build steps:', BUILD_STEPS.length, '| dispute steps:', DISPUTE_STEPS.length, '| resources:', RESOURCES.length);
}
