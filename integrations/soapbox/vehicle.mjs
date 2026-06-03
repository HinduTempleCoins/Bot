// vehicle.mjs — the SoapBox Vehicle vertical (queue task #116). Keyless US-federal vehicle data so a
// real person can answer "is this car safe / recalled / efficient?" before they buy or while they own it.
// Four government sources, no API key required:
//   - NHTSA vPIC      → VIN decode (what the VIN actually is). Slow (~3s), so cached hard.
//   - NHTSA Recalls   → open safety recalls for a make/model/year.
//   - NHTSA NCAP      → 5-star crash-test / safety ratings for a make/model/year.
//   - EPA fueleconomy → official EPA MPG (city/highway/combined) for a make/model/year.
// Same shape as macro.mjs: ESM, __setFetch hook, soft-fail (never throw), guarded CLI block.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Endpoints. All keyless. vPIC + NHTSA return JSON; EPA fueleconomy returns XML but honors Accept: json.
const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const NHTSA = 'https://api.nhtsa.gov';
const EPA = 'https://www.fueleconomy.gov/ws/rest';

// best-effort JSON GET. Returns null on any failure (network, non-2xx, bad body) — never throws.
async function getJson(url, headers = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// VIN sanity: 17 chars, alphanumeric, no I/O/Q (the standard VIN exclusions). Loose — vPIC itself is
// the real validator; this just keeps obviously-junk input from becoming a cache key / wasted fetch.
export function isVinish(vin) {
  return typeof vin === 'string' && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(vin.trim());
}

// vPIC DecodeVinValues returns ONE flat object with ~150 keys. We surface the fields a person cares
// about and keep them stable/clean ('' from vPIC → null), so downstream code/tests get a known shape.
const VIN_FIELDS = {
  Make: 'make', Model: 'model', ModelYear: 'year', Manufacturer: 'manufacturer',
  VehicleType: 'vehicleType', BodyClass: 'bodyClass', DriveType: 'driveType',
  EngineCylinders: 'engineCylinders', DisplacementL: 'displacementL', FuelTypePrimary: 'fuelType',
  PlantCountry: 'plantCountry', PlantCity: 'plantCity', Series: 'series', Trim: 'trim',
  Doors: 'doors', GVWR: 'gvwr', TransmissionStyle: 'transmission',
};

// normalize a vPIC flat record into our trimmed shape. vPIC uses '' (and the literal 'Not Applicable')
// for "no value" — both become null so consumers don't have to special-case empty strings.
export function normalizeVin(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const clean = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return (s === '' || s === 'Not Applicable') ? null : s;
  };
  const out = {};
  for (const [src, dst] of Object.entries(VIN_FIELDS)) out[dst] = clean(rec[src]);
  out.errorText = clean(rec.ErrorText);
  // ErrorCode '0' means a clean decode; anything else (or missing) is a partial/failed decode.
  out.decoded = clean(rec.ErrorCode) === '0' || (out.make != null && out.model != null);
  return out;
}

/**
 * Decode a VIN via NHTSA vPIC (DecodeVinValues — the flat, one-row variant). Returns the trimmed
 * normalized shape, or null on failure / non-VIN input. Cached at metadata-tier (1h) because vPIC is
 * slow (~3s) and a VIN never changes — repeat lookups of the same VIN should be instant.
 */
export async function decodeVin(vin) {
  if (!isVinish(vin)) return null;
  const v = vin.trim().toUpperCase();
  return cached(`vehicle:vin:${v}`, TTL.metadata, async () => {
    const j = await getJson(`${VPIC}/DecodeVinValues/${encodeURIComponent(v)}?format=json`);
    const rec = j?.Results?.[0];
    return normalizeVin(rec);
  });
}

/**
 * Open NHTSA safety recalls for a make/model/year. Returns { count, recalls:[...] } or null.
 * Each recall is trimmed to the human-useful fields. Cached at metadata-tier (recalls change rarely).
 */
export async function recalls({ make, model, year } = {}) {
  if (!make || !model || !year) return null;
  const key = `vehicle:recalls:${make}:${model}:${year}`.toLowerCase();
  return cached(key, TTL.metadata, async () => {
    const url = `${NHTSA}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const j = await getJson(url);
    if (!j || !Array.isArray(j.results)) return null;
    const recalls = j.results.map((r) => ({
      campaign: r.NHTSACampaignNumber || null,
      component: r.Component || null,
      summary: r.Summary || null,
      consequence: r.Consequence || null,
      remedy: r.Remedy || null,
      reportDate: r.ReportReceivedDate || null,
    }));
    return { make, model, year: String(year), count: recalls.length, recalls };
  });
}

/**
 * NHTSA NCAP safety ratings (5-star crash test) for a make/model/year. The NHTSA SafetyRatings API is
 * a two-step lookup: first list the vehicle variants for that year/make/model (each has a VehicleId),
 * then fetch the rated detail for the first variant. Returns { variants, rating } or null.
 * Cached at metadata-tier — star ratings don't move.
 */
export async function safetyRatings({ make, model, year } = {}) {
  if (!make || !model || !year) return null;
  const key = `vehicle:safety:${make}:${model}:${year}`.toLowerCase();
  return cached(key, TTL.metadata, async () => {
    const listUrl = `${NHTSA}/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
    const list = await getJson(listUrl);
    const variants = Array.isArray(list?.Results) ? list.Results : [];
    if (!variants.length) return { make, model, year: String(year), variants: [], rating: null };
    const trimmedVariants = variants.map((v) => ({ id: v.VehicleId, description: v.VehicleDescription }));
    const id = variants[0].VehicleId;
    let rating = null;
    if (id != null) {
      const det = await getJson(`${NHTSA}/SafetyRatings/VehicleId/${encodeURIComponent(id)}`);
      const d = det?.Results?.[0];
      if (d) {
        rating = {
          vehicleId: id,
          description: d.VehicleDescription || null,
          overall: d.OverallRating || null,
          frontCrash: d.OverallFrontCrashRating || null,
          sideCrash: d.OverallSideCrashRating || null,
          rollover: d.RolloverRating || null,
        };
      }
    }
    return { make, model, year: String(year), variants: trimmedVariants, rating };
  });
}

/**
 * EPA official MPG (fueleconomy.gov) for a make/model/year. Two-step: get the menu of EPA "options"
 * (each a trim with a numeric id), then fetch that vehicle's economy detail. Returns
 * { options, economy } or null. Cached at metadata-tier — EPA figures are fixed per model year.
 */
export async function fuelEconomy({ make, model, year } = {}) {
  if (!make || !model || !year) return null;
  const key = `vehicle:mpg:${make}:${model}:${year}`.toLowerCase();
  return cached(key, TTL.metadata, async () => {
    const menuUrl = `${EPA}/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;
    const menu = await getJson(menuUrl);
    // EPA menu: { menuItem: [...] } — but a single result comes back as a bare object, normalize to array.
    let items = menu?.menuItem;
    if (!items) return { make, model, year: String(year), options: [], economy: null };
    if (!Array.isArray(items)) items = [items];
    const options = items.map((o) => ({ id: o.value, label: o.text })).filter((o) => o.id != null);
    if (!options.length) return { make, model, year: String(year), options: [], economy: null };
    let economy = null;
    const det = await getJson(`${EPA}/vehicle/${encodeURIComponent(options[0].id)}`);
    if (det) {
      const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
      economy = {
        id: options[0].id,
        city: num(det.city08), highway: num(det.highway08), combined: num(det.comb08),
        fuelType: det.fuelType || null,
        annualFuelCost: num(det.fuelCost08),
        co2: num(det.co2TailpipeGpm),
      };
    }
    return { make, model, year: String(year), options, economy };
  });
}

/**
 * One-shot: decode a VIN, then pull recalls + safety + MPG for the decoded make/model/year in parallel.
 * Returns { vin, vehicle, recalls, safety, fuelEconomy } — any sub-section that fails is null, never
 * throws. The whole point of the vertical: paste a VIN, get the full picture.
 */
export async function vehicleSummary(vin) {
  const vehicle = await decodeVin(vin);
  if (!vehicle || !vehicle.make || !vehicle.model || !vehicle.year) {
    return { vin: typeof vin === 'string' ? vin.trim().toUpperCase() : null, vehicle, recalls: null, safety: null, fuelEconomy: null };
  }
  const q = { make: vehicle.make, model: vehicle.model, year: vehicle.year };
  const [rc, sr, fe] = await Promise.all([
    recalls(q).catch(() => null),
    safetyRatings(q).catch(() => null),
    fuelEconomy(q).catch(() => null),
  ]);
  return { vin: vin.trim().toUpperCase(), vehicle, recalls: rc, safety: sr, fuelEconomy: fe };
}

if (process.argv[1] && process.argv[1].endsWith('vehicle.mjs')) {
  const vin = process.argv[2] || '1HGCM82633A004352'; // sample Honda Accord VIN
  const s = await vehicleSummary(vin);
  console.log(JSON.stringify(s, null, 2));
}
