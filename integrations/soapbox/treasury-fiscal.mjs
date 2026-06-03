// treasury-fiscal.mjs — "Where the money actually goes" reader over the U.S. Treasury Fiscal Data API
// (fiscaldata.treasury.gov). KEYLESS + free. Complements macro.mjs (markets/forex) and gov-readers.mjs
// (USAspending = where money goes OUT) by covering the DEBT / FISCAL side: the national debt to the
// penny, the average interest the government pays on that debt, the Treasury's own quarterly exchange
// rates, and the Daily Treasury Statement operating cash balance.
//
// Every reader:
//   • normalizes the Fiscal Data { data:[...], meta, links } shape into flat, predictable records,
//   • SOFT-FAILS to [] (or null for scalars) on any error / non-ok / missing data — never throws,
//   • carries as-of dates from the source rows.
//
// Keyless: the Fiscal Data API requires no key and no token. NO secrets here, by construction.
//
//   import { nationalDebt, interestRates, exchangeRates, dailyStatement,
//            summary, renderPage, dataNote } from './treasury-fiscal.mjs'
//   node integrations/soapbox/treasury-fiscal.mjs debt 30

const API = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)', Accept: 'application/json' };

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const SOURCE = 'U.S. Treasury Fiscal Data';

// Escape for safe HTML interpolation (the strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Fiscal Data wraps results as { data: [...], meta, links }. Pull the rows array, soft to [].
async function fetchData(endpoint, params = {}) {
  try {
    const p = new URLSearchParams(params);
    const r = await _fetch(`${API}${endpoint}?${p.toString()}`, { headers: UA });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch { return []; }
}

// ── National debt — debt to the penny ───────────────────────────────────────────────────────────────
// /v2/accounting/od/debt_to_penny. One row per business day; we take the most recent `days`, newest
// first, and normalize to { date, totalDebt }. Soft-fails to [].
export async function nationalDebt({ days = 30 } = {}) {
  const n = Math.max(1, Math.min(366, num(days) || 30));
  const rows = await fetchData('/v2/accounting/od/debt_to_penny', {
    fields: 'record_date,tot_pub_debt_out_amt',
    sort: '-record_date',
    'page[size]': String(n),
  });
  return rows
    .map((d) => ({ date: str(d.record_date), totalDebt: num(d.tot_pub_debt_out_amt) }))
    .filter((x) => x.date && x.totalDebt != null);
}

// ── Average interest rates on the national debt ─────────────────────────────────────────────────────
// /v2/accounting/od/avg_interest_rates. Latest reporting month, one row per security type/description.
export async function interestRates() {
  // grab the latest batch (newest first); keep only rows from the most recent record_date.
  const rows = await fetchData('/v2/accounting/od/avg_interest_rates', {
    fields: 'record_date,security_type_desc,security_desc,avg_interest_rate_amt',
    sort: '-record_date',
    'page[size]': '60',
  });
  if (!rows.length) return [];
  const latest = str(rows[0].record_date);
  return rows
    .filter((d) => str(d.record_date) === latest)
    .map((d) => ({
      date: str(d.record_date),
      securityType: str(d.security_type_desc),
      security: str(d.security_desc),
      rate: num(d.avg_interest_rate_amt),
    }))
    .filter((x) => x.security && x.rate != null);
}

// ── Treasury reporting rates of exchange (quarterly) ────────────────────────────────────────────────
// /v1/accounting/od/rates_of_exchange. Optionally filter by country (case-insensitive contains).
export async function exchangeRates({ country = '' } = {}) {
  const want = str(country).toLowerCase();
  const rows = await fetchData('/v1/accounting/od/rates_of_exchange', {
    fields: 'record_date,country,currency,exchange_rate,effective_date',
    sort: '-record_date',
    'page[size]': '200',
  });
  return rows
    .map((d) => ({
      date: str(d.record_date),
      country: str(d.country),
      currency: str(d.currency),
      rate: num(d.exchange_rate),
      effectiveDate: str(d.effective_date),
    }))
    .filter((x) => x.country && x.rate != null)
    .filter((x) => !want || x.country.toLowerCase().includes(want) || x.currency.toLowerCase().includes(want));
}

// ── Daily Treasury Statement — operating cash balance ───────────────────────────────────────────────
// /v1/accounting/dts/operating_cash_balance. Latest day's closing balances (e.g. Federal Reserve Account).
export async function dailyStatement() {
  const rows = await fetchData('/v1/accounting/dts/operating_cash_balance', {
    fields: 'record_date,account_type,open_today_bal,close_today_bal',
    sort: '-record_date',
    'page[size]': '20',
  });
  if (!rows.length) return [];
  const latest = str(rows[0].record_date);
  return rows
    .filter((d) => str(d.record_date) === latest)
    .map((d) => ({
      date: str(d.record_date),
      account: str(d.account_type),
      openBalance: num(d.open_today_bal),
      closeBalance: num(d.close_today_bal),
    }))
    .filter((x) => x.account);
}

// ── Headline summary — current debt + latest average rate ───────────────────────────────────────────
export async function summary() {
  const [debt, rates] = await Promise.all([
    nationalDebt({ days: 2 }).catch(() => []),
    interestRates().catch(() => []),
  ]);
  const latestDebt = debt[0] || null; // newest first
  // headline rate = the "Total Interest-bearing Debt" line if present, else the first rate row.
  const totalRate = rates.find((r) => /total interest-bearing/i.test(r.security)) || rates[0] || null;
  return {
    debtDate: latestDebt ? latestDebt.date : '',
    totalDebt: latestDebt ? latestDebt.totalDebt : null,
    rateDate: totalRate ? totalRate.date : '',
    avgInterestRate: totalRate ? totalRate.rate : null,
    asOf: new Date().toISOString(),
  };
}

// ── Provenance note ─────────────────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}`;
}

const fmtUsd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtPct = (n) => (n == null ? '—' : Number(n).toFixed(3) + '%');

// ── Render an escaped HTML section ──────────────────────────────────────────────────────────────────
// data = { summary, debt:[{date,totalDebt}], rates:[{security,rate,...}] }. All interpolated values
// are HTML-escaped. Returns a self-contained <section>.
export function renderPage(data = {}) {
  const s = data.summary || {};
  const debt = Array.isArray(data.debt) ? data.debt : [];
  const rates = Array.isArray(data.rates) ? data.rates : [];

  // trend: compare newest vs oldest in the supplied debt series.
  let trend = '';
  if (debt.length >= 2) {
    const newest = debt[0].totalDebt;
    const oldest = debt[debt.length - 1].totalDebt;
    if (newest != null && oldest != null && oldest !== 0) {
      const delta = newest - oldest;
      const pct = (delta / oldest) * 100;
      const dir = delta >= 0 ? '▲' : '▼';
      trend = `<p class="trend">${esc(dir)} ${esc(fmtUsd(Math.abs(delta)))} (${esc((delta >= 0 ? '+' : '') + pct.toFixed(2))}%) `
        + `over ${esc(String(debt.length))} reporting days</p>`;
    }
  }

  const headDebt = s.totalDebt != null ? s.totalDebt : (debt[0]?.totalDebt ?? null);
  const headDate = str(s.debtDate) || str(debt[0]?.date);

  const rateRows = rates.slice(0, 12).map((r) => (
    `<tr><td>${esc(r.security)}</td><td>${esc(r.securityType || '')}</td><td class="num">${esc(fmtPct(r.rate))}</td></tr>`
  )).join('');

  return [
    '<section class="treasury-fiscal">',
    '  <h2>U.S. National Debt &amp; Fiscal Picture</h2>',
    `  <p class="figure"><strong>${esc(fmtUsd(headDebt))}</strong>`,
    headDate ? ` <span class="asof">as of ${esc(headDate)}</span>` : '',
    '</p>',
    trend,
    rateRows
      ? '  <h3>Average interest rates on the debt</h3>'
        + '<table class="rates"><thead><tr><th>Security</th><th>Type</th><th>Avg rate</th></tr></thead>'
        + `<tbody>${rateRows}</tbody></table>`
      : '',
    `  <p class="note">${esc(dataNote(s.asOf || headDate))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('treasury-fiscal.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'debt') out('national debt', await nationalDebt({ days: num(arg) || 30 }));
  else if (cmd === 'rates') out('interest rates', await interestRates());
  else if (cmd === 'fx') out('exchange rates', await exchangeRates({ country: arg }));
  else if (cmd === 'dts') out('daily statement', await dailyStatement());
  else if (cmd === 'summary') out('summary', await summary());
  else if (cmd === 'page') {
    const [s, debt, rates] = await Promise.all([summary(), nationalDebt({ days: 30 }), interestRates()]);
    console.log(renderPage({ summary: s, debt, rates }));
  } else console.log('usage: treasury-fiscal.mjs <debt [days]|rates|fx [country]|dts|summary|page>');
}
