// vehicle-history.mjs — SoapBox vehicle history report (queue task #118). HONEST scope: this is
// NMVTIS-backed only — it reports what the federal National Motor Vehicle Title Information System
// actually exposes: title records (state + dates), title brands (salvage/junk/flood/rebuilt/lemon),
// odometer readings, salvage/total-loss records, and theft records. It is NOT CarFax: it does NOT
// include CarFax's proprietary dealer-maintenance, insurance-claim, or service-record databases. We
// say that plainly rather than implying a parity we don't have.
//
// Reader goes through the VinAudit API (process.env.VINAUDIT_KEY), which is an authorized NMVTIS data
// provider. With NO key in the env the reader SOFT-FAILS to a clear "configure provider" stub and
// NEVER throws — same contract as macro.mjs. summarizeHistory() is PURE and works on an injected
// record, so the offline tests exercise normalization + flag logic with no network at all.
//
// Same shape as macro.mjs: ESM, __setFetch hook, soft-fail (never throw), guarded CLI block.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Title brands that mean the vehicle was declared a total loss or otherwise structurally compromised.
// Normalized to lowercase substrings; matched against whatever the provider reports.
const SALVAGE_BRAND_HINTS = ['salvage', 'junk', 'total loss', 'totaled', 'rebuilt', 'reconstructed', 'flood', 'fire', 'hail', 'lemon', 'dismantled', 'scrap', 'parts only', 'non-repairable', 'nonrepairable'];

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : (x == null ? null : String(x)));

// --- normalization (pure) ---------------------------------------------------------------------------

/**
 * normalizeRecord(raw, { vin, source, fetched_at }) — pure. Maps a VinAudit/NMVTIS-style JSON blob
 * into our stable shape regardless of which exact field names the provider used:
 *   { vin, titleRecords[], brands[], odometer[], salvage[], theft[], source, fetched_at }
 * Always returns the full shape (empty arrays when absent). Never throws.
 */
export function normalizeRecord(raw, { vin = '', source = 'vinaudit', fetched_at = new Date().toISOString() } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const arr = (x) => (Array.isArray(x) ? x : []);

  const titleRecords = arr(r.titles ?? r.titleRecords ?? r.title_records).map((t) => ({
    state: str(t?.state ?? t?.title_state),
    date: str(t?.date ?? t?.title_date),
    mileage: num(t?.mileage ?? t?.odometer),
    current: !!(t?.current ?? t?.is_current),
  }));

  // brands can come as objects or bare strings; flatten to a list of {type, state, date}.
  const brands = arr(r.brands ?? r.title_brands ?? r.titleBrands).map((b) =>
    typeof b === 'string'
      ? { type: str(b), state: null, date: null }
      : { type: str(b?.type ?? b?.brand ?? b?.name), state: str(b?.state), date: str(b?.date) }
  ).filter((b) => b.type);

  const odometer = arr(r.odometer ?? r.odometers ?? r.odometer_records).map((o) => ({
    reading: num(o?.reading ?? o?.mileage ?? o?.value),
    date: str(o?.date),
    source: str(o?.source),
  })).filter((o) => o.reading != null || o.date != null);

  const salvage = arr(r.salvage ?? r.salvage_records ?? r.junk ?? r.total_loss).map((s) =>
    typeof s === 'string'
      ? { type: str(s), date: null, state: null }
      : { type: str(s?.type ?? s?.disposition ?? s?.name) ?? 'salvage', date: str(s?.date), state: str(s?.state) }
  );

  const theft = arr(r.theft ?? r.theft_records ?? r.thefts).map((t) =>
    typeof t === 'string'
      ? { status: str(t), date: null }
      : { status: str(t?.status ?? t?.type) ?? 'theft', date: str(t?.date), recovered: t?.recovered ?? null }
  );

  return { vin: str(vin) || str(r.vin) || '', titleRecords, brands, odometer, salvage, theft, source, fetched_at };
}

// --- summary (pure) ---------------------------------------------------------------------------------

/**
 * summarizeHistory(record) — PURE. Inspects a normalized record and raises the three flags that
 * matter most to a buyer:
 *   - salvage  : any salvage/total-loss record OR any title brand that implies a total loss
 *   - odometerRollback : a later-dated odometer/title reading that is LOWER than an earlier one
 *   - theft    : any theft record present (recovered or not)
 * Returns { vin, flags:{salvage,odometerRollback,theft}, clean, brands[], titleCount, notes[] }.
 * `clean` is true only when none of the flags fired. Never throws; tolerant of partial records.
 */
export function summarizeHistory(record) {
  const rec = record && typeof record === 'object' ? record : {};
  const brands = Array.isArray(rec.brands) ? rec.brands : [];
  const salvageRecs = Array.isArray(rec.salvage) ? rec.salvage : [];
  const theftRecs = Array.isArray(rec.theft) ? rec.theft : [];
  const titles = Array.isArray(rec.titleRecords) ? rec.titleRecords : [];
  const odos = Array.isArray(rec.odometer) ? rec.odometer : [];
  const notes = [];

  // salvage: explicit salvage records, or a brand that means total loss.
  const brandedSalvage = brands.some((b) => {
    const t = (b?.type || '').toLowerCase();
    return SALVAGE_BRAND_HINTS.some((h) => t.includes(h));
  });
  const salvage = salvageRecs.length > 0 || brandedSalvage;
  if (salvage) notes.push('Salvage / total-loss / structural-damage title brand on record.');

  // odometer rollback: gather (date, reading) points from odometer rows AND title rows, sort by date,
  // and flag if any later reading is meaningfully lower than an earlier one.
  const points = [];
  for (const o of odos) if (o?.reading != null && o?.date) points.push({ date: o.date, reading: Number(o.reading) });
  for (const t of titles) if (t?.mileage != null && t?.date) points.push({ date: t.date, reading: Number(t.mileage) });
  points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let odometerRollback = false;
  let peak = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.reading)) continue;
    if (p.reading + 1 < peak) { odometerRollback = true; break; } // a later reading went DOWN
    if (p.reading > peak) peak = p.reading;
  }
  if (odometerRollback) notes.push('Odometer rollback suspected — a later reading is lower than an earlier one.');

  const theft = theftRecs.length > 0;
  if (theft) notes.push('Theft record on file (recovered or active).');

  const flags = { salvage, odometerRollback, theft };
  return {
    vin: str(rec.vin) || '',
    flags,
    clean: !salvage && !odometerRollback && !theft,
    brands: brands.map((b) => b?.type).filter(Boolean),
    titleCount: titles.length,
    notes,
  };
}

// --- provider status + reader (key-gated, soft-fail) ------------------------------------------------

/**
 * providerStatus() — is an NMVTIS data provider wired? Always describes the honest scope so callers
 * never imply CarFax parity. Never throws.
 */
export function providerStatus() {
  const configured = !!process.env.VINAUDIT_KEY;
  return {
    provider: 'vinaudit',
    configured,
    backed_by: 'NMVTIS',
    scope: 'title records, title brands (salvage/junk/flood/rebuilt/lemon), odometer, salvage/total-loss, theft',
    not_included: 'CarFax proprietary dealer-maintenance, insurance-claim, and service records',
    message: configured ? 'NMVTIS provider configured.' : 'Set VINAUDIT_KEY to enable NMVTIS-backed vehicle history.',
  };
}

// best-effort JSON GET. Returns null on any failure — never throws.
async function getJson(url, headers = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * history(vin) — NMVTIS-backed vehicle history for a VIN, via VinAudit. Returns the normalized shape:
 *   { titleRecords, brands, odometer, salvage, theft, source, fetched_at }  (plus vin)
 * SOFT-FAIL: with no VINAUDIT_KEY set, returns a clear "configure provider" stub (empty arrays,
 * source 'none', a `configured:false` flag and a message) — it NEVER throws. Cached 60s by VIN.
 */
export async function history(vin) {
  const v = typeof vin === 'string' ? vin.trim().toUpperCase() : '';
  const stub = (extra) => ({
    vin: v, titleRecords: [], brands: [], odometer: [], salvage: [], theft: [],
    source: 'none', configured: false, fetched_at: new Date().toISOString(),
    message: 'Set VINAUDIT_KEY to enable NMVTIS-backed vehicle history.', ...extra,
  });
  if (!v) return stub({ message: 'No VIN supplied.' });
  if (!process.env.VINAUDIT_KEY) return stub();

  return cached(`vehicle-history:${v}`, TTL.price, async () => {
    const key = process.env.VINAUDIT_KEY;
    const j = await getJson(`https://specifications.vinaudit.com/v3/specifications?key=${encodeURIComponent(key)}&vin=${encodeURIComponent(v)}&format=json&include=history`).catch(() => null)
      || await getJson(`https://api.vinaudit.com/v2/historyreport?key=${encodeURIComponent(key)}&vin=${encodeURIComponent(v)}&format=json`).catch(() => null);
    if (!j) return stub({ source: 'vinaudit', configured: true, message: 'Provider returned no data for this VIN.' });
    const blob = j.history ?? j.report ?? j;
    return { ...normalizeRecord(blob, { vin: v, source: 'vinaudit' }), configured: true };
  });
}

if (process.argv[1] && process.argv[1].endsWith('vehicle-history.mjs')) {
  const vin = process.argv[2];
  if (vin) {
    const rec = await history(vin);
    console.log(JSON.stringify(rec, null, 2));
    console.log('\nSummary:', JSON.stringify(summarizeHistory(rec), null, 2));
  } else {
    console.log(JSON.stringify(providerStatus(), null, 2));
    // demo the pure summary on a synthetic salvage + rollback + theft record
    const demo = normalizeRecord({
      vin: 'DEMO123',
      titles: [{ state: 'TX', date: '2019-03-01', mileage: 40000 }, { state: 'CA', date: '2021-06-01', mileage: 25000 }],
      brands: [{ type: 'Salvage', state: 'TX', date: '2020-01-01' }],
      theft: [{ status: 'Reported stolen', date: '2020-08-01', recovered: true }],
    }, { vin: 'DEMO123' });
    console.log('\nDemo summary:', JSON.stringify(summarizeHistory(demo), null, 2));
  }
}
