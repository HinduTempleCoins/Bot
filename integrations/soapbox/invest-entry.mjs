// invest-entry.mjs — "Where to invest" entry-points panel for the SoapBox Stocks pages (task #53).
// Mirrors how the crypto side handles on-ramps (macro.mjs ENTRY_POINTS / WHERE_TO_BUY): curated static
// data + small pure helpers, no required network. For a given stock/ETF/ticker we surface the major
// US-accessible BROKERS, a few broad low-cost index ETFs as EDUCATIONAL getting-started examples, and
// the common tax-advantaged RETIREMENT_VEHICLES — then assemble a panel payload for the page.
//
// This is informational only — NOT financial advice (see DISCLAIMER). No secrets, no API keys, and NO
// affiliate codes are baked in. Each broker carries an `affiliate` field that is null by default; if the
// operator ever adds an FTC-disclosed referral param, it goes there (and the UI must disclose it).

// ── Brokers ───────────────────────────────────────────────────────────────────────────────────────
// Major US-accessible brokers. Facts kept to the durable, uncontroversial kind: commission-free online
// US stock/ETF trades (industry standard since 2019) and whether fractional shares are offered. The
// `affiliate` placeholder is null by default — no referral codes shipped.
export const BROKERS = [
  {
    name: 'Fidelity', kind: 'broker', url: 'https://www.fidelity.com/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Full-service broker; commission-free US stocks & ETFs; fractional shares; IRAs/HSAs.',
  },
  {
    name: 'Charles Schwab', kind: 'broker', url: 'https://www.schwab.com/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Commission-free US stocks & ETFs; fractional S&P 500 "Stock Slices"; broad account types.',
  },
  {
    name: 'Vanguard', kind: 'broker', url: 'https://investor.vanguard.com/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Home of low-cost index funds & ETFs; commission-free online trades; long-term/retirement focus.',
  },
  {
    name: 'Robinhood', kind: 'broker', url: 'https://robinhood.com/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Mobile-first; commission-free US stocks & ETFs; fractional shares; offers IRAs.',
  },
  {
    name: 'Interactive Brokers', kind: 'broker', url: 'https://www.interactivebrokers.com/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Global market access; IBKR Lite has commission-free US stocks/ETFs; fractional shares.',
  },
  {
    name: 'Public', kind: 'broker', url: 'https://public.com/',
    fractional: true, commissionFree: true, retirementAccounts: false, affiliate: null,
    notes: 'Commission-free US stocks & ETFs; fractional shares; social/community investing app.',
  },
  {
    name: 'SoFi Invest', kind: 'broker', url: 'https://www.sofi.com/invest/',
    fractional: true, commissionFree: true, retirementAccounts: true, affiliate: null,
    notes: 'Commission-free US stocks & ETFs; fractional "stock bits"; offers IRAs.',
  },
];

// ── ETF getting-started examples (EDUCATIONAL, not picks) ────────────────────────────────────────────
// A few broad, low-cost index ETFs commonly cited as "starter" diversified exposure. These are EXAMPLES
// to illustrate what a broad index fund is — not recommendations. expenseNote is kept qualitative so it
// doesn't go stale; always confirm the current expense ratio on the issuer's fact sheet.
export const ETF_ENTRY = [
  { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', assetClass: 'US equities (total market)', expenseNote: 'Very low expense ratio (confirm current on issuer fact sheet)' },
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', assetClass: 'US large-cap (S&P 500)', expenseNote: 'Very low expense ratio (confirm current on issuer fact sheet)' },
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF', assetClass: 'Global equities (US + international)', expenseNote: 'Low expense ratio (confirm current on issuer fact sheet)' },
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', assetClass: 'US investment-grade bonds', expenseNote: 'Very low expense ratio (confirm current on issuer fact sheet)' },
];

// ── Tax-advantaged retirement vehicles ──────────────────────────────────────────────────────────────
// Plain-English one-liners. The account TYPES are durable; specific contribution limits change yearly so
// they're intentionally left out.
export const RETIREMENT_VEHICLES = [
  { name: 'Roth IRA', description: 'Individual retirement account funded with after-tax money; qualified withdrawals in retirement are tax-free.' },
  { name: 'Traditional IRA', description: 'Individual retirement account; contributions may be tax-deductible now, withdrawals are taxed in retirement.' },
  { name: '401(k)', description: 'Employer-sponsored plan; pre-tax (or Roth) payroll contributions, often with an employer match.' },
  { name: 'HSA', description: 'Health Savings Account (needs a high-deductible health plan); triple tax advantage and can be invested for the long term.' },
];

// Not-advice disclaimer — surfaced on the panel and exported for the page to display.
export const DISCLAIMER =
  'Educational information only — not financial, investment, tax, or legal advice. Brokers and ETFs ' +
  'shown are examples, not recommendations. Do your own research and consider a licensed professional ' +
  'before investing. Confirm all fees, features, and account details directly with the provider.';

/**
 * Build the "where to invest" entry-points panel for a stock/ETF/ticker.
 * Accepts a ticker string or a stock-like object ({ symbol } or { ticker }).
 * Soft-fails to a safe default panel (no ticker) for unknown/empty/garbage input.
 * @returns {{ ticker: string|null, brokers: object[], etfExamples: object[], retirement: object[], disclaimer: string }}
 */
export function entryPointsFor(stockOrTicker) {
  let ticker = null;
  try {
    if (typeof stockOrTicker === 'string') {
      ticker = stockOrTicker.trim().toUpperCase() || null;
    } else if (stockOrTicker && typeof stockOrTicker === 'object') {
      const raw = stockOrTicker.symbol ?? stockOrTicker.ticker;
      if (typeof raw === 'string') ticker = raw.trim().toUpperCase() || null;
    }
  } catch { ticker = null; }

  return {
    ticker,
    brokers: BROKERS,
    etfExamples: ETF_ENTRY,
    retirement: RETIREMENT_VEHICLES,
    disclaimer: DISCLAIMER,
  };
}

if (process.argv[1] && process.argv[1].endsWith('invest-entry.mjs')) {
  const arg = process.argv[2] || 'AAPL';
  const panel = entryPointsFor(arg);
  console.log(`\n  Where to invest — entry points for ${panel.ticker || '(general)'}\n`);
  console.log('  Brokers (US-accessible):');
  for (const b of panel.brokers) console.log(`    ${b.name.padEnd(20)} fractional:${b.fractional ? 'y' : 'n'} commission-free:${b.commissionFree ? 'y' : 'n'} retirement:${b.retirementAccounts ? 'y' : 'n'}  ${b.url}`);
  console.log('\n  Broad index ETF examples (educational):');
  for (const e of panel.etfExamples) console.log(`    ${e.ticker.padEnd(5)} ${e.name}  — ${e.assetClass}`);
  console.log('\n  Retirement vehicles:');
  for (const r of panel.retirement) console.log(`    ${r.name.padEnd(16)} ${r.description}`);
  console.log(`\n  ${panel.disclaimer}\n`);
}
