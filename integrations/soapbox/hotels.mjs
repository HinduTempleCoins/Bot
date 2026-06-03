// hotels.mjs — hotel affiliate search/booking for SoapBox (queue #145). The "Atlas hotel model":
// a real person books a hotel through us, the affiliate program pays a commission on that booking, and
// a slice of that commission funds a LOYALTY-token kickback to the booker. This is loyalty, not income —
// you don't earn money by traveling, you earn loyalty tokens for routing a trip you were taking anyway.
//
// Hotels sit in the FAT affiliate tier (~4–7% commission, vs ~1–3% for flights/retail), so they fund the
// biggest kickback — which is why hotels lead the travel surface. Providers are all keyed via process.env
// and SOFT-FAIL: no key (or a failed call) just drops that provider, never throws. Follows macro.mjs:
// ESM, __setFetch hook, soft-fail, CLI guarded by process.argv[1].endsWith('hotels.mjs').

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Affiliate / booking providers. Each: env key it needs + endpoint + a normalizer mapping the provider's
// raw shape to our common row. All gated on process.env[*_KEY] — absent key ⇒ provider skipped silently.
// Hotels = the fat 4–7% commission tier; assumed rate used to size the loyalty kickback when previewing.
export const PROVIDERS = [
  {
    name: 'Booking.com Demand',
    envKey: 'BOOKING_DEMAND_KEY',
    commissionRate: 0.06, // ~6% — Booking's Demand API affiliate tier sits at the top of the fat band
    url: (q) => `https://demandapi.booking.com/3.1/accommodations/search?city=${encodeURIComponent(q.city)}&checkin=${encodeURIComponent(q.checkin)}&checkout=${encodeURIComponent(q.checkout)}`,
    pick: (json) => json?.data || json?.results || [],
    map: (h) => ({
      name: h?.name ?? h?.hotel_name ?? null,
      price: num(h?.price?.amount ?? h?.min_total_price ?? h?.price),
      rating: num(h?.review_score ?? h?.rating),
      affiliateUrl: h?.url ?? h?.booking_url ?? null,
    }),
  },
  {
    name: 'Expedia Rapid',
    envKey: 'EXPEDIA_RAPID_KEY',
    commissionRate: 0.05, // ~5%
    url: (q) => `https://api.ean.com/v3/properties/availability?city=${encodeURIComponent(q.city)}&checkin=${encodeURIComponent(q.checkin)}&checkout=${encodeURIComponent(q.checkout)}`,
    pick: (json) => json?.properties || json?.data || [],
    map: (h) => ({
      name: h?.name ?? null,
      price: num(h?.rate?.totals?.inclusive?.amount ?? h?.price?.total ?? h?.price),
      rating: num(h?.guestRating ?? h?.starRating ?? h?.rating),
      affiliateUrl: h?.links?.web?.href ?? h?.deepLink ?? null,
    }),
  },
  {
    name: 'Hotelbeds',
    envKey: 'HOTELBEDS_KEY',
    commissionRate: 0.07, // ~7% — wholesale net rates leave the fattest margin
    url: (q) => `https://api.hotelbeds.com/hotel-api/1.0/hotels?destination=${encodeURIComponent(q.city)}&checkin=${encodeURIComponent(q.checkin)}&checkout=${encodeURIComponent(q.checkout)}`,
    pick: (json) => json?.hotels?.hotels || json?.hotels || [],
    map: (h) => ({
      name: h?.name?.content ?? h?.name ?? null,
      price: num(h?.minRate ?? h?.rooms?.[0]?.rates?.[0]?.net),
      rating: num(h?.categoryName ? parseFloat(h.categoryName) : h?.rating),
      affiliateUrl: h?.url ?? null,
    }),
  },
  {
    name: 'Travelpayouts',
    envKey: 'TRAVELPAYOUTS_KEY',
    commissionRate: 0.04, // ~4% — aggregator, bottom of the fat band but widest inventory
    url: (q) => `https://engine.hotellook.com/api/v2/cache.json?location=${encodeURIComponent(q.city)}&checkIn=${encodeURIComponent(q.checkin)}&checkOut=${encodeURIComponent(q.checkout)}`,
    pick: (json) => json?.results || json || [],
    map: (h) => ({
      name: h?.hotelName ?? h?.name ?? null,
      price: num(h?.priceFrom ?? h?.priceAvg ?? h?.price),
      rating: num(h?.stars ?? h?.rating),
      affiliateUrl: h?.fullUrl ?? h?.url ?? null,
    }),
  },
];

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normalize one provider's raw response into our common rows; drops rows with no name. PURE given json. */
export function normalize(provider, json) {
  const rows = (provider.pick?.(json) || []);
  return (Array.isArray(rows) ? rows : [])
    .map((h) => provider.map(h))
    .filter((r) => r && r.name);
}

/**
 * PURE loyalty-token kickback math. Given the commission a booking earns (currency amount) and the share
 * `rate` (0..1) of that commission we route back as loyalty tokens, returns the kickback amount. This is
 * the Atlas hotel model: booking earns commission → commission funds the token kickback. Loyalty, not income.
 * Clamps rate to [0,1] and never returns negative/NaN; non-finite inputs ⇒ 0.
 */
export function kickback(commission, rate) {
  const c = Number(commission);
  let r = Number(rate);
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(r)) return 0;
  if (r < 0) r = 0;
  if (r > 1) r = 1;
  return c * r;
}

/**
 * Search hotels across all configured providers (those with their *_KEY set). Returns normalized rows
 * {name, price, rating, affiliateUrl}, soft-failing per provider — a missing key or a thrown/!ok call
 * just drops that provider. Results are merged and sorted cheapest-first (null prices last).
 */
export async function searchHotels({ city, checkin, checkout } = {}) {
  if (!city || !checkin || !checkout) return [];
  const q = { city, checkin, checkout };
  const lists = await Promise.all(PROVIDERS.map(async (p) => {
    const key = process.env[p.envKey];
    if (!key) return []; // no key ⇒ provider not configured, skip silently
    try {
      const r = await _fetch(p.url(q), { headers: { 'user-agent': UA, 'accept': 'application/json' } });
      if (!r || !r.ok) return [];
      const json = await r.json();
      return normalize(p, json).map((row) => ({ ...row, provider: p.name }));
    } catch { return []; } // soft-fail: never let one provider break the search
  }));
  return lists.flat().sort((a, b) => {
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
}

if (process.argv[1] && process.argv[1].endsWith('hotels.mjs')) {
  const configured = PROVIDERS.filter((p) => process.env[p.envKey]).map((p) => p.name);
  console.log(`Configured hotel providers: ${configured.length ? configured.join(', ') : '(none — set *_KEY env vars)'}`);
  const rows = await searchHotels({ city: process.argv[2] || 'London', checkin: process.argv[3] || '2026-07-01', checkout: process.argv[4] || '2026-07-03' });
  for (const r of rows.slice(0, 10)) console.log(`  ${String(r.name).padEnd(40)} ${r.price ?? '—'}  ★${r.rating ?? '—'}  [${r.provider}]`);
  if (!rows.length) console.log('  (no results — add affiliate keys to query live inventory)');
}
