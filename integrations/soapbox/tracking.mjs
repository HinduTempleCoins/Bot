// tracking.mjs — multi-carrier package tracking for SoapBox (queue #144). Tiered failover across
// keyed aggregators (AfterShip → Ship24 → 17TRACK), then carrier-direct stubs (USPS/UPS/FedEx/DHL).
// Everything soft-fails and never throws; the worst case is an empty normalized result with a note.
// All providers are normalized to ONE schema, provenance-tagged so the UI can show where data came from.
// Follows macro.mjs: ESM, __setFetch hook, CLI guarded by argv[1].endsWith('tracking.mjs').

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';

// Canonical carrier registry. `slug` is the lowercase id we normalize to; `aftership`/`s24`/`t17` are
// the per-aggregator courier identifiers (best-effort — aggregators auto-detect too). `direct` flags
// carriers we have a carrier-direct stub for.
export const CARRIERS = {
  usps:  { slug: 'usps',  label: 'USPS',  aftership: 'usps',     s24: 'usps',     t17: '21051', direct: true },
  ups:   { slug: 'ups',   label: 'UPS',   aftership: 'ups',      s24: 'ups',      t17: '100002', direct: true },
  fedex: { slug: 'fedex', label: 'FedEx', aftership: 'fedex',    s24: 'fedex',    t17: '100003', direct: true },
  dhl:   { slug: 'dhl',   label: 'DHL',   aftership: 'dhl',      s24: 'dhl',      t17: '7041', direct: true },
  unknown: { slug: 'unknown', label: 'Unknown', direct: false },
};

// ── PURE carrier detection ────────────────────────────────────────────────────────────────────────
// Detect the carrier from the tracking-number format alone. No network, no side effects, deterministic.
// Patterns are ordered most-specific-first; the first match wins. Returns a CARRIERS slug string.
//
// USPS:  20–22 digit numerics; "9400/9205/9407/9303/9270/92" IMpb barcodes; USS13 SXX#########US (e.g. EC/CP...US).
// UPS:   "1Z" + 16 alnum; also "T" + 10 digits, or 9-digit "MI" forms (kept loose).
// FedEx: 12, 15, or 20 digit numerics (Express/Ground/SmartPost).
// DHL:   10–11 digits (Express), or "JD"/"JJD" + long numeric (eCommerce), or 3-digit + 8-9 digit Air Waybill.
const RE = {
  ups: [
    /^1Z[0-9A-Z]{16}$/i,        // 1Z tracking
    /^T\d{10}$/i,               // UPS "T" form
    /^\d{9}$/,                  // UPS Mail Innovations / freight (9 digits)
  ],
  usps: [
    /^(94|93|92|95)\d{18,24}$/, // IMpb 20–26 digit, common 94.. prefixes
    /^(91|92|93|94|95|96)\d{18,20}$/,
    /^[A-Z]{2}\d{9}US$/i,       // S10 international ...US (EC123456789US)
    /^\d{20,22}$/,              // bare 20–22 digit USPS
  ],
  fedex: [
    /^\d{12}$/,                 // FedEx Express (12)
    /^\d{15}$/,                 // FedEx Ground (15)
    /^\d{20}$/,                 // FedEx SmartPost / 96-prefixed (20)
    /^\d{34}$/,                 // FedEx Ground 96 barcode (34)
  ],
  dhl: [
    /^J[JD]D\d{10,18}$/i,       // DHL eCommerce JJD/JD...
    /^\d{10,11}$/,              // DHL Express air waybill (10–11)
    /^\d{3}-?\d{8}$/,           // DHL air waybill 3+8
  ],
};

/** PURE: detect carrier slug from a tracking number's format. Returns 'usps'|'ups'|'fedex'|'dhl'|'unknown'. */
export function detectCarrier(num) {
  if (typeof num !== 'string') return 'unknown';
  const n = num.replace(/[\s-]/g, '').trim();
  if (!n) return 'unknown';
  // UPS 1Z is unambiguous — check first.
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return 'ups';
  // USPS S10 international (...US) is unambiguous.
  if (/^[A-Z]{2}\d{9}US$/i.test(n)) return 'usps';
  // DHL eCommerce JJD/JD prefix is unambiguous.
  if (/^J[JD]D\d{10,18}$/i.test(n)) return 'dhl';
  // UPS "T" form.
  if (/^T\d{10}$/i.test(n)) return 'ups';
  // Pure-numeric: disambiguate by length (most-specific lengths first).
  if (/^\d+$/.test(n)) {
    const L = n.length;
    if (L >= 20) return 'usps';   // long IMpb / 20–22 USPS (also covers FedEx-20 collision → favor USPS bare)
    if (L === 15) return 'fedex';
    if (L === 12) return 'fedex';
    if (L === 10 || L === 11) return 'dhl';
    if (L === 9) return 'ups';
  }
  return 'unknown';
}

// ── normalized schema ───────────────────────────────────────────────────────────────────────────
// { carrier, status, checkpoints: [{ time, message, location, status }], eta, provider, tracking }
// `status` is a coarse label; `provider` is the provenance tag (which source produced this result).
function emptyResult(tracking, carrier, provider, note) {
  return { tracking, carrier, status: 'unknown', checkpoints: [], eta: null, provider, note: note || null };
}

// ── keyed aggregators ─────────────────────────────────────────────────────────────────────────────
// Each returns a normalized result on success, or null to fall through to the next tier. They soft-fail:
// a missing key, a non-ok response, or a parse error all return null (never throw).

async function tryAfterShip(num, carrier) {
  const key = process.env.AFTERSHIP_KEY;
  if (!key) return null;
  try {
    const slug = CARRIERS[carrier]?.aftership;
    const url = `https://api.aftership.com/v4/trackings/${slug ? slug + '/' : ''}${encodeURIComponent(num)}`;
    const r = await _fetch(url, { headers: { 'aftership-api-key': key, 'user-agent': UA } });
    if (!r.ok) return null;
    const t = (await r.json())?.data?.tracking;
    if (!t) return null;
    const checkpoints = (t.checkpoints || []).map((c) => ({
      time: c.checkpoint_time || c.created_at || null,
      message: c.message || '',
      location: [c.city, c.state, c.country_name].filter(Boolean).join(', ') || null,
      status: c.tag || c.subtag || null,
    }));
    return {
      tracking: num,
      carrier: t.slug || carrier,
      status: t.tag || 'unknown',
      checkpoints,
      eta: t.expected_delivery || null,
      provider: 'aftership',
      note: null,
    };
  } catch { return null; }
}

async function tryShip24(num, carrier) {
  const key = process.env.SHIP24_KEY;
  if (!key) return null;
  try {
    const r = await _fetch('https://api.ship24.com/public/v1/trackers/track', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ trackingNumber: num, courierCode: CARRIERS[carrier]?.s24 ? [CARRIERS[carrier].s24] : undefined }),
    });
    if (!r.ok) return null;
    const tr = (await r.json())?.data?.trackings?.[0];
    if (!tr) return null;
    const events = tr.events || [];
    const checkpoints = events.map((e) => ({
      time: e.occurrenceDatetime || e.datetime || null,
      message: e.status || '',
      location: e.location || null,
      status: e.statusMilestone || e.statusCategory || null,
    }));
    return {
      tracking: num,
      carrier: tr.shipment?.recipient?.slug || tr.tracker?.courierCode?.[0] || carrier,
      status: tr.shipment?.statusMilestone || tr.shipment?.statusCategory || 'unknown',
      checkpoints,
      eta: tr.shipment?.delivery?.estimatedDeliveryDate || null,
      provider: 'ship24',
      note: null,
    };
  } catch { return null; }
}

async function try17Track(num, carrier) {
  const key = process.env.SEVENTEENTRACK_KEY || process.env.T17_KEY;
  if (!key) return null;
  try {
    const r = await _fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: { '17token': key, 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify([{ number: num, carrier: CARRIERS[carrier]?.t17 ? Number(CARRIERS[carrier].t17) : undefined }]),
    });
    if (!r.ok) return null;
    const acc = (await r.json())?.data?.accepted?.[0];
    const info = acc?.track_info || acc?.track;
    if (!info) return null;
    const providers = info.tracking?.providers || [];
    const events = providers.flatMap((p) => p.events || []);
    const checkpoints = events.map((e) => ({
      time: e.time_iso || e.time_utc || null,
      message: e.description || '',
      location: e.location || [e.address?.city, e.address?.country].filter(Boolean).join(', ') || null,
      status: e.stage || e.sub_status || null,
    }));
    return {
      tracking: num,
      carrier,
      status: info.latest_status?.status || info.e || 'unknown',
      checkpoints,
      eta: info.time_metrics?.estimated_delivery_date?.from || null,
      provider: '17track',
      note: null,
    };
  } catch { return null; }
}

// ── carrier-direct stubs ────────────────────────────────────────────────────────────────────────
// Placeholders for direct carrier APIs (USPS Web Tools, UPS, FedEx, DHL). These require carrier-specific
// OAuth/registration not yet wired; they return a normalized empty result with a note so the failover
// chain has a final, honest tier instead of silently dropping. Each returns null if it can't apply.
function directStub(provider) {
  return async (num, carrier) => {
    // No carrier-direct credentials/integration yet — return an honest placeholder result.
    return emptyResult(num, carrier, provider, 'carrier-direct integration not yet wired (stub)');
  };
}
const DIRECT_STUBS = {
  usps: directStub('usps-direct'),
  ups: directStub('ups-direct'),
  fedex: directStub('fedex-direct'),
  dhl: directStub('dhl-direct'),
};

/**
 * Track a package. Auto-detects the carrier, then tries each tier in order until one returns data:
 *   AfterShip → Ship24 → 17TRACK → carrier-direct stub.
 * Always resolves to a normalized result (never throws). If nothing produced checkpoints, the result
 * carries the last-tier note so the UI can explain the empty state.
 */
export async function track(num) {
  const tracking = typeof num === 'string' ? num.trim() : '';
  const carrier = detectCarrier(tracking);
  if (!tracking) return emptyResult(tracking, carrier, 'none', 'empty tracking number');

  const tiers = [tryAfterShip, tryShip24, try17Track];
  let fallback = null; // a real provider hit that had no checkpoints yet (e.g. tracker just created)
  for (const tier of tiers) {
    const res = await tier(tracking, carrier).catch(() => null);
    if (res && res.checkpoints && res.checkpoints.length) return res;
    if (res && !fallback) fallback = res;
  }
  if (fallback) return fallback;
  // Aggregators produced nothing usable — try the carrier-direct stub for the detected carrier.
  const direct = DIRECT_STUBS[carrier];
  if (direct) {
    const res = await direct(tracking, carrier).catch(() => null);
    if (res) return res;
  }
  return emptyResult(tracking, carrier, 'none', 'no provider returned tracking data');
}

if (process.argv[1] && process.argv[1].endsWith('tracking.mjs')) {
  const num = process.argv[2] || '1Z999AA10123456784';
  const res = await track(num);
  console.log(`carrier: ${res.carrier}  status: ${res.status}  via: ${res.provider}`);
  console.log(`eta: ${res.eta || '—'}  checkpoints: ${res.checkpoints.length}${res.note ? '  note: ' + res.note : ''}`);
  for (const c of res.checkpoints) console.log(`  ${c.time || ''}  ${c.message}  ${c.location || ''}`);
}
