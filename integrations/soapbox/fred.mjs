// fred.mjs — the SoapBox "track the economy" reader over the Federal Reserve FRED API (St. Louis Fed
// economic data, api.stlouisfed.org). One source: FRED's /series/observations endpoint, which returns a
// dated value series for any FRED series id — interest rates, CPI, unemployment, GDP, money supply,
// mortgage rates, Treasury yields, etc.
//
// This is the STANDALONE economic-series reader. coliving.mjs already uses FRED internally for the
// cost-of-living fusion (CPI + its provenance math); that cost-of-living calculation is NOT duplicated
// here — this module is purely "give me a normalized economic series / latest value / a dashboard".
//
// Like epa-enviro.mjs / coliving.mjs / weather.mjs this is a READER only: every getter soft-fails
// (returns [] / null, never throws) and a dead source just drops out. FRED requires a free API key,
// referenced by ENV NAME only (FRED_API_KEY) — never logged, never printed, never committed. When the
// key is absent the series getters soft-fail clearly (empty series / null) exactly as a network failure
// would, so the page never breaks.
//
//   import { series, SERIES, latest, dashboard, renderPage, dataNote } from './fred.mjs'
//   node integrations/soapbox/fred.mjs                # the economy at a glance (dashboard)
//   node integrations/soapbox/fred.mjs UNRATE         # one series (latest + recent observations)

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const asOfDate = () => new Date().toISOString().slice(0, 10);

// Escape any text before it lands in HTML. Mirrors the project convention (epa-enviro.mjs etc.).
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Curated friendly-name → FRED series id map. "The economy at a glance" lives off this set. FRED ids are
// stable public identifiers (not secrets). Keep the list short and load-bearing.
export const SERIES = {
  'Fed Funds Rate': 'DFF',          // Effective federal funds rate, % (daily)
  'CPI': 'CPIAUCSL',                // Consumer Price Index, all urban, index level (monthly)
  'Unemployment': 'UNRATE',         // Civilian unemployment rate, % (monthly)
  'Real GDP': 'GDPC1',              // Real Gross Domestic Product, billions chained $ (quarterly)
  '30yr Mortgage': 'MORTGAGE30US',  // 30-year fixed mortgage average, % (weekly)
  'M2 Money Supply': 'M2SL',        // M2 money stock, billions $ (monthly)
  '10yr Treasury': 'DGS10',         // 10-year Treasury constant maturity yield, % (daily)
};

// Friendly unit hint per series id, used only for display. Unknown ids fall through to ''.
const UNITS = {
  DFF: '%', CPIAUCSL: 'index', UNRATE: '%', GDPC1: '$B',
  MORTGAGE30US: '%', M2SL: '$B', DGS10: '%',
};
export function seriesUnit(seriesId) { return UNITS[str(seriesId)] || ''; }

// Read the FRED key by ENV NAME only. null when unset → series getters soft-fail clearly.
function fredKey() { return process.env.FRED_API_KEY || null; }

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Fetch a FRED observation series, normalized to [{ date, value }] (oldest → newest, FRED's default
 * order). Non-numeric FRED values (the sentinel ".") are dropped. Soft-fails to [] on any error, an
 * unusable payload, OR when FRED_API_KEY is absent (no key → no series, never a throw).
 * @param {string} seriesId            a FRED series id (e.g. 'UNRATE')
 * @param {{start?:string,end?:string}} opts  optional ISO date bounds (observation_start/_end)
 */
export async function series(seriesId, { start, end } = {}) {
  const id = str(seriesId);
  if (!id) return [];
  const key = fredKey();
  if (!key) return []; // no key → soft-fail clearly, exactly like a network failure

  let url = 'https://api.stlouisfed.org/fred/series/observations'
    + `?series_id=${encodeURIComponent(id)}`
    + '&file_type=json'
    + `&api_key=${encodeURIComponent(key)}`;
  if (str(start)) url += `&observation_start=${encodeURIComponent(str(start))}`;
  if (str(end)) url += `&observation_end=${encodeURIComponent(str(end))}`;

  const j = await getJson(url);
  return normalizeObservations(j);
}

// Normalize a FRED /series/observations payload → [{ date, value }]. PURE. Drops the "." sentinel and any
// non-numeric value. Soft-fails to [] on anything unusable.
export function normalizeObservations(json) {
  const rows = json && Array.isArray(json.observations) ? json.observations : null;
  if (!rows) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.value === '.' || r.value == null) continue;
    const value = num(r.value);
    const date = str(r.date);
    if (value == null || !date) continue;
    out.push({ date, value });
  }
  return out;
}

/**
 * Most recent value of a series + change from the prior observation. Returns
 *   { seriesId, value, date, change, changePct, prevValue, prevDate, unit }
 * or null when there's no usable data (soft-fail). `change` is value − prevValue (null if no prior).
 */
export async function latest(seriesId, { start, end } = {}) {
  const obs = await series(seriesId, { start, end });
  return latestFromObservations(seriesId, obs);
}

// PURE: derive the latest-value record from a normalized [{date,value}] series. null if empty.
export function latestFromObservations(seriesId, obs) {
  const arr = Array.isArray(obs) ? obs : [];
  if (arr.length === 0) return null;
  const last = arr[arr.length - 1];
  const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
  const change = prev ? Math.round((last.value - prev.value) * 1000) / 1000 : null;
  const changePct = (prev && prev.value !== 0)
    ? Math.round(((last.value / prev.value - 1) * 100) * 1000) / 1000
    : null;
  return {
    seriesId: str(seriesId),
    value: last.value,
    date: last.date,
    change,
    changePct,
    prevValue: prev ? prev.value : null,
    prevDate: prev ? prev.date : null,
    unit: seriesUnit(seriesId),
  };
}

/**
 * "The economy at a glance" — the latest value (+ change) for every curated SERIES entry. Returns
 *   { asOf, items: [{ name, seriesId, value, date, change, changePct, unit } | { name, seriesId, value:null }] }
 * Each series soft-fails independently to a null-valued row, so a dead/keyless source just shows n/a and
 * never breaks the dashboard. Never throws.
 */
export async function dashboard() {
  const names = Object.keys(SERIES);
  const items = await Promise.all(names.map(async (name) => {
    const seriesId = SERIES[name];
    const rec = await latest(seriesId).catch(() => null);
    if (!rec) return { name, seriesId, value: null, date: null, change: null, changePct: null, unit: seriesUnit(seriesId) };
    return { name, ...rec };
  }));
  return { asOf: asOfDate(), items };
}

// ── provenance note ───────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Source: FRED, Federal Reserve Bank of St. Louis (api.stlouisfed.org), as of ${asOfDate()}. ` +
    `Series update on their own official cadence (daily / weekly / monthly / quarterly) and recent ` +
    `values may be revised. This is public reference, not financial advice.`;
}

// ── renderPage — escaped HTML economic dashboard / series table ───────────────────────────────────────
// data may be:
//   • a dashboard() result { asOf, items } → renders the "at a glance" grid, OR
//   • a single-series view { name, seriesId, observations:[{date,value}], latest? } → renders a table.
// EVERY interpolated value is escaped. Safe on missing / empty inputs.
export function renderPage(data = {}) {
  // single-series table view
  if (data && Array.isArray(data.observations)) {
    const name = str(data.name) || str(data.seriesId) || 'Series';
    const unit = seriesUnit(data.seriesId);
    const obs = data.observations;
    const rows = obs.map((o) => `<tr>` +
      `<td>${escapeHtml(o.date)}</td>` +
      `<td>${escapeHtml(o.value)}${unit ? ` ${escapeHtml(unit)}` : ''}</td>` +
      `</tr>`).join('');
    const lat = data.latest || latestFromObservations(data.seriesId, obs);
    const latLine = lat && lat.value != null
      ? `<p class="latest">Latest: <strong>${escapeHtml(lat.value)}${unit ? ` ${escapeHtml(unit)}` : ''}</strong> ` +
        `(${escapeHtml(lat.date)})${lat.change != null ? `, change ${escapeHtml(lat.change)}` : ''}</p>`
      : `<p class="latest">No data.</p>`;
    return `<section class="fred-series">
  <h2>${escapeHtml(name)} <span class="sid">${escapeHtml(data.seriesId)}</span></h2>
  ${latLine}
  <table class="observations">
    <thead><tr><th>Date</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
  }

  // dashboard "at a glance" grid view
  const items = data && Array.isArray(data.items) ? data.items : [];
  const rows = items.map((it) => {
    const v = it.value == null ? 'n/a' : `${it.value}${it.unit ? ` ${it.unit}` : ''}`;
    const chg = it.change == null
      ? '—'
      : `${it.change >= 0 ? '+' : ''}${it.change}${it.changePct != null ? ` (${it.changePct >= 0 ? '+' : ''}${it.changePct}%)` : ''}`;
    return `<tr class="${it.value == null ? 'na' : (num(it.change) != null && num(it.change) < 0 ? 'down' : 'up')}">` +
      `<td>${escapeHtml(it.name)}</td>` +
      `<td class="sid">${escapeHtml(it.seriesId)}</td>` +
      `<td>${escapeHtml(v)}</td>` +
      `<td>${escapeHtml(chg)}</td>` +
      `<td>${it.date == null ? '—' : escapeHtml(it.date)}</td>` +
      `</tr>`;
  }).join('');

  return `<section class="fred-dashboard">
  <h2>Track the economy</h2>
  <table class="economy">
    <thead><tr><th>Indicator</th><th>Series</th><th>Value</th><th>Change</th><th>As of</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
// No arg → the dashboard. A series id (or curated friendly name) → that single series (latest + tail).
if (process.argv[1] && process.argv[1].endsWith('fred.mjs')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    const dash = await dashboard().catch((e) => { console.error(e.message); return null; });
    console.log('\nSoapBox — Track the Economy (FRED)');
    console.log('─'.repeat(60));
    if (!dash) console.log('No data.');
    else {
      for (const it of dash.items) {
        const v = it.value == null ? 'n/a' : `${it.value}${it.unit ? ` ${it.unit}` : ''}`;
        const chg = it.change == null ? '' : `  Δ ${it.change >= 0 ? '+' : ''}${it.change}`;
        console.log(`  ${it.name.padEnd(18)} ${String(v).padEnd(14)} [${it.seriesId}]${chg}  ${it.date || ''}`);
      }
    }
    console.log(`\n${dataNote()}`);
  } else {
    // resolve a friendly name to its id, else treat the arg as a raw series id.
    const seriesId = SERIES[arg] || arg;
    const obs = await series(seriesId).catch(() => []);
    const lat = latestFromObservations(seriesId, obs);
    console.log(`\nFRED series ${seriesId}  (${obs.length} observations)`);
    console.log('─'.repeat(60));
    if (lat) console.log(`  latest: ${lat.value}${lat.unit ? ` ${lat.unit}` : ''} (${lat.date})  change: ${lat.change ?? 'n/a'}`);
    else console.log('  No data (set FRED_API_KEY for live data).');
    for (const o of obs.slice(-8)) console.log(`    ${o.date}  ${o.value}`);
    console.log(`\n${dataNote()}`);
  }
}
