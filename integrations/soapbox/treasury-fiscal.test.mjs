// treasury-fiscal.test.mjs — offline tests for the Treasury Fiscal Data reader. Injects a fake fetch
// that returns canned Fiscal Data { data:[...] } payloads keyed by endpoint. No network, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, nationalDebt, interestRates, exchangeRates, dailyStatement,
  summary, renderPage, dataNote, esc,
} from './treasury-fiscal.mjs';

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data, meta: {}, links: {} }) });

// route a fake fetch by URL substring → canned payload.
function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, payload] of Object.entries(routes)) {
      if (u.includes(needle)) return ok(payload);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const DEBT = [
  { record_date: '2026-06-01', tot_pub_debt_out_amt: '34500000000000.55' },
  { record_date: '2026-05-31', tot_pub_debt_out_amt: '34400000000000.00' },
  { record_date: '2026-05-01', tot_pub_debt_out_amt: '34000000000000.00' },
];
const RATES = [
  { record_date: '2026-05-31', security_type_desc: 'Interest-bearing Debt', security_desc: 'Treasury Notes', avg_interest_rate_amt: '2.541' },
  { record_date: '2026-05-31', security_type_desc: 'Interest-bearing Debt', security_desc: 'Total Interest-bearing Debt', avg_interest_rate_amt: '3.210' },
  { record_date: '2026-04-30', security_type_desc: 'Interest-bearing Debt', security_desc: 'Treasury Notes', avg_interest_rate_amt: '2.500' }, // older month — dropped
];
const FX = [
  { record_date: '2026-03-31', country: 'Canada', currency: 'Dollar', exchange_rate: '1.36', effective_date: '2026-03-31' },
  { record_date: '2026-03-31', country: 'Japan', currency: 'Yen', exchange_rate: '151.2', effective_date: '2026-03-31' },
];
const DTS = [
  { record_date: '2026-06-01', account_type: 'Federal Reserve Account', open_today_bal: '700000', close_today_bal: '725000' },
  { record_date: '2026-05-31', account_type: 'Federal Reserve Account', open_today_bal: '690000', close_today_bal: '700000' }, // older — dropped
];

test('nationalDebt normalizes the debt series (newest first)', async () => {
  __setFetch(mockFetch({ debt_to_penny: DEBT }));
  const rows = await nationalDebt({ days: 30 });
  __setFetch();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { date: '2026-06-01', totalDebt: 34500000000000.55 });
  assert.equal(rows[0].totalDebt > rows[2].totalDebt, true);
});

test('nationalDebt soft-fails to [] on non-ok', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const rows = await nationalDebt({ days: 30 });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('nationalDebt soft-fails to [] on fetch throw', async () => {
  __setFetch(async () => { throw new Error('network'); });
  const rows = await nationalDebt();
  __setFetch();
  assert.deepEqual(rows, []);
});

test('interestRates returns only the latest reporting month', async () => {
  __setFetch(mockFetch({ avg_interest_rates: RATES }));
  const rows = await interestRates();
  __setFetch();
  assert.equal(rows.length, 2); // April row dropped
  assert.equal(rows.every((r) => r.date === '2026-05-31'), true);
  assert.equal(rows[0].rate, 2.541);
});

test('interestRates soft-fails to [] on error', async () => {
  __setFetch(async () => { throw new Error('x'); });
  const rows = await interestRates();
  __setFetch();
  assert.deepEqual(rows, []);
});

test('exchangeRates normalizes and filters by country', async () => {
  __setFetch(mockFetch({ rates_of_exchange: FX }));
  const all = await exchangeRates();
  assert.equal(all.length, 2);
  assert.deepEqual(all[0], { date: '2026-03-31', country: 'Canada', currency: 'Dollar', rate: 1.36, effectiveDate: '2026-03-31' });
  const jp = await exchangeRates({ country: 'japan' });
  __setFetch();
  assert.equal(jp.length, 1);
  assert.equal(jp[0].currency, 'Yen');
});

test('dailyStatement returns latest day balances', async () => {
  __setFetch(mockFetch({ operating_cash_balance: DTS }));
  const rows = await dailyStatement();
  __setFetch();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closeBalance, 725000);
  assert.equal(rows[0].date, '2026-06-01');
});

test('summary picks the headline debt + total interest-bearing rate', async () => {
  __setFetch(mockFetch({ debt_to_penny: DEBT, avg_interest_rates: RATES }));
  const s = await summary();
  __setFetch();
  assert.equal(s.totalDebt, 34500000000000.55);
  assert.equal(s.debtDate, '2026-06-01');
  assert.equal(s.avgInterestRate, 3.210); // the "Total Interest-bearing Debt" line
  assert.ok(s.asOf);
});

test('summary soft-fails to nulls when sources die', async () => {
  __setFetch(async () => { throw new Error('down'); });
  const s = await summary();
  __setFetch();
  assert.equal(s.totalDebt, null);
  assert.equal(s.avgInterestRate, null);
});

test('renderPage escapes injected content', () => {
  const html = renderPage({
    summary: { totalDebt: 34500000000000, debtDate: '2026-06-01', asOf: '2026-06-01' },
    debt: [{ date: '2026-06-01', totalDebt: 34500000000000 }, { date: '2026-05-01', totalDebt: 34000000000000 }],
    rates: [{ security: '<script>alert(1)</script>', securityType: 'Bonds & "stuff"', rate: 2.5 }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;')); // the & in Bonds & "stuff"
  assert.ok(html.includes('&quot;'));
  assert.ok(html.includes('National Debt'));
});

test('renderPage handles empty data without throwing', () => {
  const html = renderPage({});
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('<section'));
});

test('dataNote has source + as-of', () => {
  const note = dataNote('2026-06-01');
  assert.ok(note.includes('U.S. Treasury Fiscal Data'));
  assert.ok(note.includes('as of 2026-06-01'));
  const def = dataNote();
  assert.ok(def.includes('as of'));
});

test('esc escapes all five characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
