// sec-edgar.mjs — "Read the actual filings" reader over SEC EDGAR's free, KEYLESS data APIs
// (data.sec.gov + efts.sec.gov). Where macro.mjs/stocks.mjs give you the price and the scams module
// gives you complaints, this gives you the PRIMARY SOURCE: a company's own SEC filings (10-K annual
// reports, 10-Q quarterly, 8-K material events), its XBRL financial facts (Revenues, NetIncomeLoss,
// Assets…), and full-text search across all filings. No quotes here — that's stocks.mjs's job.
//
// Every reader:
//   • normalizes EDGAR's quirky JSON shapes into flat, predictable records,
//   • SOFT-FAILS to [] (or null for scalars) on any error / non-ok / missing data — never throws,
//   • carries as-of timestamps.
//
// Keyless: EDGAR requires NO key and NO token. NO secrets here, by construction. BUT the SEC's fair-
// access policy REQUIRES a descriptive User-Agent that identifies the requester with a contact. We set
// a generic project UA (no personal email) pointing at the public contact page. Requests without a
// proper UA get throttled/blocked by data.sec.gov.
//
//   import { lookupCik, recentFilings, companyFacts, fullTextSearch,
//            summary, renderPage, dataNote } from './sec-edgar.mjs'
//   node integrations/soapbox/sec-edgar.mjs filings AAPL

const DATA = 'https://data.sec.gov';
const FTS = 'https://efts.sec.gov/LATEST/search-index'; // EDGAR full-text search index
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SOURCE = 'SEC EDGAR';

// SEC fair-access REQUIRES a descriptive UA with a contact. Generic project UA, no personal email.
const UA = {
  'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community/contact)',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate',
};

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation (the strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// CIKs are 10-digit zero-padded in API paths but bare integers elsewhere. Normalize both ways.
const padCik = (cik) => str(cik).replace(/^CIK/i, '').replace(/\D/g, '').padStart(10, '0');
const bareCik = (cik) => String(parseInt(padCik(cik), 10) || 0);

// GET JSON with the required UA, soft-fail to null. All readers funnel through here.
async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Ticker → CIK ──────────────────────────────────────────────────────────────────────────────────
// company_tickers.json is a keyed object: { "0": { cik_str, ticker, title }, ... }. Resolve a ticker
// (case-insensitive) to its zero-padded CIK. Soft-fails to null.
export async function lookupCik(ticker) {
  const want = str(ticker).toUpperCase();
  if (!want) return null;
  const j = await getJson(TICKERS_URL);
  if (!j || typeof j !== 'object') return null;
  for (const row of Object.values(j)) {
    if (row && str(row.ticker).toUpperCase() === want) {
      return { cik: padCik(row.cik_str), ticker: str(row.ticker).toUpperCase(), title: str(row.title) };
    }
  }
  return null;
}

// ── Recent filings ──────────────────────────────────────────────────────────────────────────────────
// data.sec.gov/submissions/CIK##########.json. The recent block is column-oriented (parallel arrays
// under filings.recent). Zip into rows, optionally filter by form type, normalize, cap at `limit`.
export async function recentFilings({ cik, type = '', limit = 20 } = {}) {
  const id = padCik(cik);
  if (!id || id === '0000000000') return [];
  const j = await getJson(`${DATA}/submissions/CIK${id}.json`);
  const rec = j?.filings?.recent;
  if (!rec || !Array.isArray(rec.accessionNumber)) return [];

  const want = str(type).toUpperCase();
  const n = Math.max(1, Math.min(200, num(limit) || 20));
  const bare = bareCik(id);
  const out = [];
  for (let i = 0; i < rec.accessionNumber.length; i++) {
    const form = str(rec.form?.[i]);
    if (want && form.toUpperCase() !== want) continue;
    const accNo = str(rec.accessionNumber[i]);
    const accNoDash = accNo.replace(/-/g, '');
    const primaryDoc = str(rec.primaryDocument?.[i]);
    out.push({
      form,
      filingDate: str(rec.filingDate?.[i]),
      reportDate: str(rec.reportDate?.[i]),
      accessionNo: accNo,
      primaryDoc,
      primaryDescription: str(rec.primaryDocDescription?.[i]),
      // canonical EDGAR Archives URL to the actual filing document.
      url: primaryDoc
        ? `https://www.sec.gov/Archives/edgar/data/${bare}/${accNoDash}/${primaryDoc}`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${id}&type=${encodeURIComponent(form)}`,
    });
    if (out.length >= n) break;
  }
  return out;
}

// ── Company facts (XBRL financials) ─────────────────────────────────────────────────────────────────
// A single concept: data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/<concept>.json
// (falls back to companyfacts and pulls the concept out). Returns a normalized series, newest first.
export async function companyFacts({ cik, concept = 'Revenues', taxonomy = 'us-gaap', unit = 'USD' } = {}) {
  const id = padCik(cik);
  const c = str(concept);
  if (!id || id === '0000000000' || !c) return [];

  // primary: the dedicated companyconcept endpoint (smaller payload).
  let units = null;
  const cc = await getJson(`${DATA}/api/xbrl/companyconcept/CIK${id}/${encodeURIComponent(taxonomy)}/${encodeURIComponent(c)}.json`);
  if (cc?.units) units = cc.units;
  else {
    // fallback: the full companyfacts blob, then dig out the concept.
    const cf = await getJson(`${DATA}/api/xbrl/companyfacts/CIK${id}.json`);
    units = cf?.facts?.[taxonomy]?.[c]?.units || null;
  }
  if (!units || typeof units !== 'object') return [];

  // pick the requested unit, else the first available unit array.
  const series = units[unit] || Object.values(units).find((v) => Array.isArray(v)) || [];
  return series
    .map((d) => ({
      end: str(d.end),
      start: str(d.start),
      val: num(d.val),
      fy: d.fy == null ? null : num(d.fy),
      fp: str(d.fp),
      form: str(d.form),
      filed: str(d.filed),
    }))
    .filter((x) => x.end && x.val != null)
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0)); // newest first
}

// ── Full-text search ────────────────────────────────────────────────────────────────────────────────
// EDGAR full-text search API: efts.sec.gov/LATEST/search-index?q=...  Returns hits we normalize to
// { form, filingDate, accessionNo, cik, companyName, url }. Soft-fails to [].
export async function fullTextSearch({ q, forms = '', limit = 20 } = {}) {
  const query = str(q);
  if (!query) return [];
  const params = new URLSearchParams({ q: query });
  if (str(forms)) params.set('forms', str(forms));
  const j = await getJson(`${FTS}?${params.toString()}`);
  const hits = j?.hits?.hits;
  if (!Array.isArray(hits)) return [];

  const n = Math.max(1, Math.min(100, num(limit) || 20));
  return hits.slice(0, n).map((h) => {
    const s = h?._source || {};
    // _id is like "0000320193-23-000106:aapl-20230930.htm"
    const id = str(h._id);
    const [accNo, doc] = id.split(':');
    const cikRaw = Array.isArray(s.cik) ? s.cik[0] : s.cik;
    const cik = padCik(cikRaw);
    const accNoDash = str(accNo).replace(/-/g, '');
    const name = Array.isArray(s.display_names) ? str(s.display_names[0]) : str(s.display_names);
    return {
      form: str(s.file_type || s.root_form),
      filingDate: str(s.file_date),
      accessionNo: str(accNo),
      cik,
      companyName: name,
      url: (cik && accNoDash && doc)
        ? `https://www.sec.gov/Archives/edgar/data/${bareCik(cik)}/${accNoDash}/${doc}`
        : `${FTS}?q=` + encodeURIComponent(query),
    };
  }).filter((x) => x.accessionNo);
}

// ── Headline summary ────────────────────────────────────────────────────────────────────────────────
// Latest 10-K + latest 10-Q + a headline financial fact (most-recent Revenues, else NetIncomeLoss).
export async function summary({ cik } = {}) {
  const id = padCik(cik);
  if (!id || id === '0000000000') {
    return { cik: '', latest10K: null, latest10Q: null, headlineFact: null, asOf: new Date().toISOString() };
  }
  const [tenK, tenQ, rev] = await Promise.all([
    recentFilings({ cik: id, type: '10-K', limit: 1 }).catch(() => []),
    recentFilings({ cik: id, type: '10-Q', limit: 1 }).catch(() => []),
    companyFacts({ cik: id, concept: 'Revenues' }).catch(() => []),
  ]);
  let fact = rev[0] || null;
  let factName = 'Revenues';
  if (!fact) {
    const ni = await companyFacts({ cik: id, concept: 'NetIncomeLoss' }).catch(() => []);
    if (ni[0]) { fact = ni[0]; factName = 'NetIncomeLoss'; }
  }
  return {
    cik: id,
    latest10K: tenK[0] || null,
    latest10Q: tenQ[0] || null,
    headlineFact: fact ? { concept: factName, ...fact } : null,
    asOf: new Date().toISOString(),
  };
}

// ── Provenance note ─────────────────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; filings are primary sources, not investment advice`;
}

const fmtUsd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));

// ── Render an escaped HTML filings table ──────────────────────────────────────────────────────────────
// data = { company, cik, filings:[{form,filingDate,accessionNo,primaryDoc,url}], headlineFact, asOf }.
// All interpolated values are HTML-escaped. Returns a self-contained <section>.
export function renderPage(data = {}) {
  const filings = Array.isArray(data.filings) ? data.filings : [];
  const company = str(data.company);
  const cik = str(data.cik);
  const fact = data.headlineFact || null;

  const rows = filings.slice(0, 40).map((f) => (
    '<tr>'
    + `<td>${esc(f.form)}</td>`
    + `<td>${esc(f.filingDate)}</td>`
    + `<td>${esc(f.primaryDescription || f.primaryDoc || '')}</td>`
    + `<td><a href="${esc(f.url)}" rel="nofollow noopener">${esc(f.accessionNo)}</a></td>`
    + '</tr>'
  )).join('');

  return [
    '<section class="sec-edgar">',
    `  <h2>SEC Filings${company ? ' — ' + esc(company) : ''}</h2>`,
    cik ? `  <p class="cik">CIK ${esc(cik)}</p>` : '',
    fact
      ? `  <p class="figure"><strong>${esc(fact.concept)}:</strong> ${esc(fmtUsd(fact.val))}`
        + (fact.end ? ` <span class="asof">period ending ${esc(fact.end)}</span>` : '') + '</p>'
      : '',
    rows
      ? '  <table class="filings"><thead><tr><th>Form</th><th>Filed</th><th>Description</th><th>Accession</th></tr></thead>'
        + `<tbody>${rows}</tbody></table>`
      : '  <p class="empty">No filings found.</p>',
    `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('sec-edgar.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  const resolve = async (t) => /^\d+$/.test(t) ? padCik(t) : (await lookupCik(t))?.cik;
  if (cmd === 'cik') out('cik', await lookupCik(arg));
  else if (cmd === 'filings') out('filings', await recentFilings({ cik: await resolve(arg) }));
  else if (cmd === 'facts') {
    const [t, concept] = rest;
    out('facts', (await companyFacts({ cik: await resolve(t), concept: concept || 'Revenues' })).slice(0, 8));
  } else if (cmd === 'search') out('fts', await fullTextSearch({ q: arg }));
  else if (cmd === 'summary') out('summary', await summary({ cik: await resolve(arg) }));
  else if (cmd === 'page') {
    const id = await resolve(arg);
    const [s, filings] = await Promise.all([summary({ cik: id }), recentFilings({ cik: id, limit: 20 })]);
    console.log(renderPage({ company: arg, cik: id, filings, headlineFact: s.headlineFact, asOf: s.asOf }));
  } else console.log('usage: sec-edgar.mjs <cik TICKER|filings TICKER|facts TICKER [concept]|search QUERY|summary TICKER|page TICKER>');
}
