// gov-readers.mjs — high-value KEYLESS (or soft-fail-without-key) government data readers for SoapBox
// (queue task #182). These are the "follow the money" + "what's the government doing near me" readers
// that sit behind page-ready cards. Deliberately decoupled: this file imports NOTHING from govapis.mjs
// (no shared key plumbing, no shared catalog) so a bug or key-policy change there can't break these.
//
// Every reader:
//   • normalizes its source's shape into a flat, predictable record,
//   • provenance-tags each record with { source, fetched_at } (ISO-8601 fetch timestamp),
//   • SOFT-FAILS to [] on any error, non-ok response, or missing-required-key — it NEVER throws.
//
// Keyless readers:  usaspendingAwards, usgsWater, femaDisasters, socrata (app-token optional)
// Soft-fail-on-no-key readers (need an api.data.gov / OpenStates key — return [] when absent):
//   congressBills (Congress.gov), openFecDonors (OpenFEC), openStatesBills (OpenStates)
//
//   import { usaspendingAwards, congressBills, openFecDonors, usgsWater,
//            femaDisasters, openStatesBills, socrata } from './gov-readers.mjs'
//   node integrations/soapbox/gov-readers.mjs awards "Lockheed"

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const now = () => new Date().toISOString();
// stamp a normalized record with its provenance.
const tag = (source, o) => ({ ...o, source, fetched_at: now() });

// ── USAspending — federal award search ("follow the money") ─────────────────────────────────────────
// Keyless. POST to the award search endpoint; filter by recipient name and/or awarding agency.
// Returns one row per award with amount, recipient, agency, dates.
export async function usaspendingAwards({ recipient = '', agency = '', limit = 25 } = {}) {
  const rec = str(recipient);
  const ag = str(agency);
  if (!rec && !ag) return [];
  try {
    const filters = { award_type_codes: ['A', 'B', 'C', 'D'] };
    if (rec) filters.recipient_search_text = [rec];
    if (ag) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: ag }];
    const body = {
      filters,
      fields: ['Award ID', 'Recipient Name', 'Awarding Agency', 'Award Amount', 'Start Date', 'End Date', 'Award Type', 'Description'],
      sort: 'Award Amount',
      order: 'desc',
      limit: Math.max(1, Math.min(100, num(limit) || 25)),
      page: 1,
    };
    const r = await _fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return rows.map((a) => tag('USAspending', {
      id: str(a['Award ID'] || a.generated_internal_id),
      recipient: str(a['Recipient Name']),
      agency: str(a['Awarding Agency']),
      amount: num(a['Award Amount']),
      award_type: str(a['Award Type']),
      start_date: str(a['Start Date']),
      end_date: str(a['End Date']),
      description: str(a.Description),
    })).filter((x) => x.id || x.recipient);
  } catch { return []; }
}

// ── Congress.gov — bill search (needs an api.data.gov key) ──────────────────────────────────────────
// Soft-fail to [] when process.env.CONGRESS_GOV_KEY (api.data.gov key) is absent — no network call.
export async function congressBills({ q = '', limit = 20 } = {}) {
  const key = process.env.CONGRESS_GOV_KEY || process.env.API_DATA_GOV_KEY;
  const query = str(q);
  if (!key) return [];
  try {
    const p = new URLSearchParams();
    p.set('api_key', key);
    p.set('format', 'json');
    p.set('limit', String(Math.max(1, Math.min(250, num(limit) || 20))));
    if (query) p.set('query', query);
    const r = await _fetch(`https://api.congress.gov/v3/bill?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.bills) ? j.bills : [];
    return rows.map((b) => tag('Congress.gov', {
      number: str(b.number),
      type: str(b.type),
      congress: num(b.congress),
      title: str(b.title),
      latest_action: str(b.latestAction?.text),
      action_date: str(b.latestAction?.actionDate),
      url: str(b.url),
    })).filter((x) => x.number || x.title);
  } catch { return []; }
}

// ── OpenFEC — campaign-finance donors / contributions (needs an api.data.gov key) ───────────────────
// "Follow the money" into politics. Soft-fail to [] when process.env.OPENFEC_KEY (or api.data.gov key)
// is absent. Uses Schedule A (individual contributions) full-text search.
export async function openFecDonors({ q = '', limit = 20 } = {}) {
  const key = process.env.OPENFEC_KEY || process.env.API_DATA_GOV_KEY;
  const query = str(q);
  if (!key || !query) return [];
  try {
    const p = new URLSearchParams();
    p.set('api_key', key);
    p.set('contributor_name', query);
    p.set('per_page', String(Math.max(1, Math.min(100, num(limit) || 20))));
    p.set('sort', '-contribution_receipt_date');
    const r = await _fetch(`https://api.open.fec.gov/v1/schedules/schedule_a/?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return rows.map((c) => tag('OpenFEC', {
      contributor: str(c.contributor_name),
      employer: str(c.contributor_employer),
      occupation: str(c.contributor_occupation),
      city: str(c.contributor_city),
      state: str(c.contributor_state),
      amount: num(c.contribution_receipt_amount),
      date: str(c.contribution_receipt_date),
      recipient: str(c.committee?.name || c.committee_id),
    })).filter((x) => x.contributor || x.recipient);
  } catch { return []; }
}

// ── USGS Water Services — instantaneous values for a monitoring site (keyless) ──────────────────────
// waterservices.usgs.gov instantaneous-values service. Returns one row per measured parameter at a site.
export async function usgsWater({ site = '', period = 'P1D' } = {}) {
  const id = str(site);
  if (!id) return [];
  try {
    const p = new URLSearchParams();
    p.set('format', 'json');
    p.set('sites', id);
    p.set('period', str(period) || 'P1D');
    p.set('siteStatus', 'all');
    const r = await _fetch(`https://waterservices.usgs.gov/nwis/iv/?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const series = j?.value?.timeSeries;
    if (!Array.isArray(series)) return [];
    return series.map((ts) => {
      const last = ts?.values?.[0]?.value?.slice(-1)?.[0];
      return tag('USGS Water', {
        site_id: str(ts?.sourceInfo?.siteCode?.[0]?.value) || id,
        site_name: str(ts?.sourceInfo?.siteName),
        parameter: str(ts?.variable?.variableName),
        unit: str(ts?.variable?.unit?.unitCode),
        value: num(last?.value),
        observed_at: str(last?.dateTime),
      });
    }).filter((x) => x.parameter || x.value != null);
  } catch { return []; }
}

// ── OpenFEMA — declared disasters by state (keyless) ────────────────────────────────────────────────
// DisasterDeclarationsSummaries dataset filtered by state, newest first.
export async function femaDisasters({ state = '', limit = 25 } = {}) {
  const st = str(state).toUpperCase();
  if (!st) return [];
  try {
    const p = new URLSearchParams();
    p.set('$filter', `state eq '${st}'`);
    p.set('$orderby', 'declarationDate desc');
    p.set('$top', String(Math.max(1, Math.min(1000, num(limit) || 25))));
    const r = await _fetch(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.DisasterDeclarationsSummaries) ? j.DisasterDeclarationsSummaries : [];
    return rows.map((d) => tag('OpenFEMA', {
      disaster_number: num(d.disasterNumber),
      state: str(d.state),
      title: str(d.declarationTitle),
      incident_type: str(d.incidentType),
      declaration_type: str(d.declarationType),
      declaration_date: str(d.declarationDate),
      county: str(d.designatedArea),
    })).filter((x) => x.disaster_number != null || x.title);
  } catch { return []; }
}

// ── OpenStates — state legislature bill search (needs an OpenStates API key) ────────────────────────
// Soft-fail to [] when process.env.OPENSTATES_KEY is absent. Filters by jurisdiction (state) + query.
export async function openStatesBills({ state = '', q = '', limit = 20 } = {}) {
  const key = process.env.OPENSTATES_KEY;
  const st = str(state).toLowerCase();
  const query = str(q);
  if (!key || !st) return [];
  try {
    const p = new URLSearchParams();
    p.set('jurisdiction', st);
    p.set('per_page', String(Math.max(1, Math.min(100, num(limit) || 20))));
    p.set('sort', 'latest_action_desc');
    if (query) p.set('q', query);
    const r = await _fetch(`https://v3.openstates.org/bills?${p.toString()}`, { headers: { ...UA, 'X-API-KEY': key, Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return rows.map((b) => tag('OpenStates', {
      identifier: str(b.identifier),
      title: str(b.title),
      jurisdiction: str(b.jurisdiction?.name || st),
      session: str(b.session),
      classification: Array.isArray(b.classification) ? b.classification.map(str) : [],
      latest_action: str(b.latest_action_description),
      action_date: str(b.latest_action_date),
      url: str(b.openstates_url),
    })).filter((x) => x.identifier || x.title);
  } catch { return []; }
}

// ── Socrata (SODA) — generic open-data reader for any Socrata portal (app token OPTIONAL) ───────────
// Reads a dataset by id from a portal host (e.g. data.cityofnewyork.us). $q does a full-text search.
// process.env.SOCRATA_APP_TOKEN raises rate limits when present but is NOT required (keyless works).
export async function socrata({ portal = '', datasetId = '', q = '', limit = 25 } = {}) {
  const host = str(portal).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const id = str(datasetId);
  if (!host || !id) return [];
  try {
    const p = new URLSearchParams();
    p.set('$limit', String(Math.max(1, Math.min(1000, num(limit) || 25))));
    if (str(q)) p.set('$q', str(q));
    const headers = { ...UA, Accept: 'application/json' };
    const token = process.env.SOCRATA_APP_TOKEN;
    if (token) headers['X-App-Token'] = token;
    const r = await _fetch(`https://${host}/resource/${encodeURIComponent(id)}.json?${p.toString()}`, { headers });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j) ? j : [];
    // socrata rows are arbitrary column→value maps; we pass them through but provenance-tag each.
    return rows.map((row) => tag('Socrata', { portal: host, dataset: id, record: row }));
  } catch { return []; }
}

if (process.argv[1] && process.argv[1].endsWith('gov-readers.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  const show = (label, rows) => {
    console.log(`\n== ${label} (${rows.length}) ==`);
    for (const x of rows.slice(0, 15)) console.log('  •', JSON.stringify({ ...x, fetched_at: undefined }));
  };
  let rows = [];
  if (cmd === 'awards') rows = await usaspendingAwards({ recipient: arg || 'Lockheed' });
  else if (cmd === 'bills') rows = await congressBills({ q: arg });
  else if (cmd === 'donors') rows = await openFecDonors({ q: arg });
  else if (cmd === 'water') rows = await usgsWater({ site: arg || '01646500' });
  else if (cmd === 'fema') rows = await femaDisasters({ state: arg || 'CA' });
  else if (cmd === 'states') rows = await openStatesBills({ state: rest[0] || 'ca', q: rest.slice(1).join(' ') });
  else { console.log('usage: gov-readers.mjs <awards|bills|donors|water|fema|states> <arg>'); process.exit(0); }
  show(cmd, rows);
}
